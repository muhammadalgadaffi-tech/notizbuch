// Ablauf jeder Auswertung:
//   1. Material wird auf dem Gerät zusammengestellt (context.js)
//   2. Erster Durchgang: Entwurf
//   3. Zweiter Durchgang: Selbstprüfung anhand von sechs Fragen, Ergebnis ist die Endfassung
//   4. Prüfung auf dem Gerät: Verweise auf unbekannte Einträge, Namen, die nicht im Text stehen,
//      und zu viele Rückfragen werden entfernt
// Erst danach wird etwas angezeigt.

import { store, makeId } from '../core/store.js';
import { askModel, costOf } from './api.js';
import {
  SYSTEM, AUFGABE_ANALYSE, AUFGABE_ANALYSE_PRUEFUNG, AUFGABE_FRAGE, AUFGABE_MUSTER, AUFGABE_PRUEFUNG_ALLGEMEIN,
} from './prompts.js';
import * as S from './schemas.js';
import { materialForEntry, materialForQuestion, materialForPatterns, entriesForPatterns } from './context.js';
import { norm, fingerprint, uniqueCaseless } from '../core/text.js';
import { THEMEN } from '../core/constants.js';
import { monthKey } from '../core/dates.js';

// ---------- Laufende Aufgaben ----------

const jobs = new Map();
export const getJob = (key) => jobs.get(key) || null;
export const isRunning = (key) => ['draft', 'review'].includes(jobs.get(key)?.phase);

function setJob(key, value) {
  if (value) jobs.set(key, value); else jobs.delete(key);
  store.emit(`job:${key}`, value);
  store.emit('jobs', { key, value });
}

// Ergebnisse, die fertig werden, während das Notizbuch gesperrt ist, werden nach dem Entsperren gespeichert.
const afterUnlock = [];
store.on('unlock', () => {
  for (const fn of afterUnlock.splice(0)) fn().catch((err) => console.error(err));
});
function whenUnlocked(fn) {
  if (store.unlocked) return fn();
  afterUnlock.push(fn);
  return Promise.resolve();
}

async function recordUsage(model, usage) {
  await whenUnlocked(async () => {
    const all = { ...store.kv('usage') };
    const m = monthKey();
    const month = { ...(all[m] || {}) };
    const cur = { requests: 0, cost: 0, input: 0, output: 0, ...(month[model] || {}) };
    cur.requests += 1;
    cur.cost += costOf(model, usage);
    cur.input += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    cur.output += usage.output_tokens || 0;
    month[model] = cur;
    all[m] = month;
    await store.setKV('usage', all);
  });
}

/** Entwurf + Selbstprüfung. Bei einem Fehler im zweiten Schritt kann ohne neuen Entwurf fortgesetzt werden. */
async function twoPass({ key, material, task, reviewTask, schema, checkedSchema, resume }) {
  const { apiKey, model } = store.settings;
  let draft = resume?.draft || null;
  if (!draft) {
    setJob(key, { phase: 'draft' });
    const first = await askModel({ apiKey, model, system: SYSTEM, data: material, task, schema });
    recordUsage(first.model, first.usage).catch(console.error);
    draft = first.result;
  }
  setJob(key, { phase: 'review' });
  try {
    const second = await askModel({
      apiKey,
      model,
      system: SYSTEM,
      data: material,
      task: `${reviewTask}\n\n<entwurf>\n${JSON.stringify(draft, null, 1)}\n</entwurf>`,
      schema: checkedSchema,
    });
    recordUsage(second.model, second.usage).catch(console.error);
    return { final: second.result.ergebnis || {}, check: second.result.pruefung || {}, model: second.model };
  } catch (err) {
    err.resume = { draft };
    throw err;
  }
}

const s = (v) => (typeof v === 'string' ? v.trim() : '');

function baseCheck(check, localFixes) {
  return {
    fakten_getrennt: check.fakten_getrennt !== false,
    nichts_erfunden: check.nichts_erfunden !== false,
    keine_gedankenbehauptung: check.keine_gedankenbehauptung !== false,
    alternativen_offen: check.alternativen_offen !== false,
    kein_scheinzusammenhang: check.kein_scheinzusammenhang !== false,
    gedeckt: check.gedeckt !== false,
    korrekturen: (Array.isArray(check.korrekturen) ? check.korrekturen.map(s).filter(Boolean) : []).slice(0, 8),
    lokal: localFixes,
  };
}

// ---------- 1. Einen Eintrag analysieren ----------

/** Fingerabdruck des Eintrags selbst – ändert er sich, ist die Analyse veraltet. */
export function contentHash(e) {
  return fingerprint(JSON.stringify([e.text, e.people, e.place, e.mood, e.category, e.occurredAt]));
}

/** Fingerabdruck inklusive Antworten auf Rückfragen. */
export function analysisHash(e) {
  return fingerprint(JSON.stringify([
    contentHash(e),
    e.followUps.filter((f) => f.antwort.trim()).map((f) => [f.frage, f.antwort]),
  ]));
}

function validateAnalysis(r, entry, contextIds) {
  const fixes = [];
  const ids = new Set(contextIds);
  const textNorm = norm(entry.text);

  const verbindungenRaw = Array.isArray(r.verbindungen) ? r.verbindungen : [];
  const verbindungen = verbindungenRaw.filter((v) => ids.has(v?.eintrag_id) && s(v.text));
  if (verbindungen.length < verbindungenRaw.length) fixes.push('Verweis auf einen nicht mitgeschickten Eintrag entfernt.');

  const fragenRaw = (Array.isArray(r.rueckfragen) ? r.rueckfragen : []).map(s).filter(Boolean);
  if (fragenRaw.length > 3) fixes.push('Rückfragen auf drei begrenzt.');

  const personenRaw = (Array.isArray(r.personen) ? r.personen : []).map(s).filter(Boolean);
  const personen = uniqueCaseless(personenRaw.filter((p) => p.length <= 40 && textNorm.includes(norm(p))));
  if (personen.length < uniqueCaseless(personenRaw).length) fixes.push('Name entfernt, der nicht wörtlich im Eintrag steht.');

  const result = {
    beobachtung: s(r.beobachtung),
    wahrnehmung: s(r.wahrnehmung),
    erklaerungen: (Array.isArray(r.erklaerungen) ? r.erklaerungen : [])
      .filter((x) => s(x?.text))
      .slice(0, 4)
      .map((x) => ({ text: s(x.text), einordnung: ['naheliegend', 'möglich', 'spekulativ'].includes(x.einordnung) ? x.einordnung : 'möglich' })),
    offen: s(r.offen),
    verbindungen: verbindungen.slice(0, 2).map((v) => ({ eintrag_id: v.eintrag_id, text: s(v.text) })),
    rueckfragen: fragenRaw.slice(0, 3),
    perspektive: s(r.perspektive),
    uebersehen: s(r.uebersehen),
    denkfrage: s(r.denkfrage),
    hinweis: s(r.hinweis),
    personen: personen.slice(0, 8),
    themen: [...new Set((Array.isArray(r.themen) ? r.themen : []).filter((t) => THEMEN.includes(t)))].slice(0, 3),
  };
  return { result, fixes };
}

export async function analyzeEntry(id) {
  const key = `analyse:${id}`;
  if (isRunning(key)) return;
  const entry = store.get(id);
  if (!entry) return;
  const hash = analysisHash(entry);
  const prior = jobs.get(key);
  const resume = prior?.resume && prior.hash === hash ? prior.resume : null;
  const material = resume?.material || materialForEntry(entry);

  try {
    const out = await twoPass({
      key,
      material: material.text,
      task: AUFGABE_ANALYSE,
      reviewTask: AUFGABE_ANALYSE_PRUEFUNG,
      schema: S.ANALYSE,
      checkedSchema: S.ANALYSE_GEPRUEFT,
      resume,
    });
    const { result, fixes } = validateAnalysis(out.final, entry, material.contextIds);
    const analysis = {
      result,
      check: baseCheck(out.check, fixes),
      contextIds: material.contextIds,
      model: out.model,
      at: new Date().toISOString(),
      hash,
      contentHash: contentHash(entry),
    };
    await whenUnlocked(() => store.update(id, (e) => {
      e.analysis = analysis;
      const known = new Set([...store.mentionKeys(e), ...e.people.map((p) => norm(p).trim())]);
      e.suggestions.people = result.personen.filter((p) => !known.has(norm(p).trim()));
      e.suggestions.themes = result.themen.filter((t) => t !== e.category && !e.themes.includes(t));
      e.followUps = e.followUps.filter((f) => f.antwort.trim());
    }));
    setJob(key, null);
  } catch (err) {
    console.warn('Analyse fehlgeschlagen', err);
    setJob(key, { phase: 'error', error: err, hash, resume: err.resume ? { ...err.resume, material } : null });
  }
}

export function dismissJob(key) { setJob(key, null); }

// ---------- 2. Eine Frage an das Journal ----------

export async function askJournal(question) {
  const key = 'frage';
  if (isRunning(key)) return null;
  const mat = materialForQuestion(question);
  if (!mat.ids.length) {
    const record = {
      id: makeId(), frage: question, at: new Date().toISOString(), empty: true, basis: mat.basis, ids: [],
      result: { antwort: mat.basis.range ? `Für den Zeitraum „${mat.basis.range}“ gibt es keine Einträge.` : 'Es gibt noch keine Einträge, auf die sich eine Antwort stützen könnte.', belege: [], muster: '', offen: '', denkfrage: '' },
    };
    setJob(key, { phase: 'done', record });
    return record;
  }
  const prior = jobs.get(key);
  const resume = prior?.resume && prior.question === question ? prior.resume : null;
  const material = resume?.material || mat;
  try {
    const out = await twoPass({
      key,
      material: material.text,
      task: AUFGABE_FRAGE,
      reviewTask: AUFGABE_PRUEFUNG_ALLGEMEIN,
      schema: S.FRAGE,
      checkedSchema: S.FRAGE_GEPRUEFT,
      resume,
    });
    const ids = new Set(material.ids);
    const fixes = [];
    const belegeRaw = Array.isArray(out.final.belege) ? out.final.belege : [];
    const belege = belegeRaw.filter((b) => ids.has(b?.eintrag_id)).slice(0, 8).map((b) => ({ eintrag_id: b.eintrag_id, bezug: s(b.bezug) }));
    if (belege.length < Math.min(belegeRaw.length, 8)) fixes.push('Verweis auf einen nicht mitgeschickten Eintrag entfernt.');
    const record = {
      id: makeId(),
      frage: question,
      at: new Date().toISOString(),
      basis: material.basis,
      ids: material.ids,
      model: out.model,
      result: { antwort: s(out.final.antwort), belege, muster: s(out.final.muster), offen: s(out.final.offen), denkfrage: s(out.final.denkfrage) },
      check: baseCheck(out.check, fixes),
    };
    await whenUnlocked(async () => {
      const list = [record, ...store.kv('questions').filter((q) => q.frage !== question)].slice(0, 20);
      await store.setKV('questions', list);
    });
    setJob(key, { phase: 'done', record });
    return record;
  } catch (err) {
    console.warn('Frage fehlgeschlagen', err);
    setJob(key, { phase: 'error', error: err, question, resume: err.resume ? { ...err.resume, material } : null });
    return null;
  }
}

// ---------- 3. Muster über mehrere Einträge ----------

export const patternKey = ({ days, person }) => (person ? `person:${norm(person).trim()}` : `tage:${days}`);

/** Kennung des aktuellen Datenstands – ändert sich, sobald Einträge dazukommen oder sich ändern. */
export function patternSignature(opts) {
  return fingerprint(entriesForPatterns(opts).map((e) => `${e.id}:${e.updatedAt}`).join('|'));
}

export async function findPatterns(opts) {
  const cacheKey = patternKey(opts);
  const key = `muster:${cacheKey}`;
  if (isRunning(key)) return;
  const signature = patternSignature(opts);
  const prior = jobs.get(key);
  const resume = prior?.resume && prior.signature === signature ? prior.resume : null;
  const material = resume?.material || materialForPatterns(opts);
  try {
    const out = await twoPass({
      key,
      material: material.text,
      task: AUFGABE_MUSTER,
      reviewTask: AUFGABE_PRUEFUNG_ALLGEMEIN,
      schema: S.MUSTER,
      checkedSchema: S.MUSTER_GEPRUEFT,
      resume,
    });
    const ids = new Set(material.ids);
    const fixes = [];
    const onlyKnown = (list) => {
      const raw = Array.isArray(list) ? list : [];
      const ok = [...new Set(raw.filter((x) => ids.has(x)))];
      if (ok.length < new Set(raw).size) fixes.push('Verweis auf einen nicht mitgeschickten Eintrag entfernt.');
      return ok;
    };
    const time = (id) => new Date(store.get(id)?.occurredAt || 0).getTime();
    const r = out.final;
    const result = {
      aufgefallen: (Array.isArray(r.aufgefallen) ? r.aufgefallen : [])
        .map((a) => ({ text: s(a?.text), eintraege: onlyKnown(a?.eintraege).sort((x, y) => time(x) - time(y)) }))
        .filter((a) => a.text && a.eintraege.length)
        .slice(0, 4),
      muster: (Array.isArray(r.muster) ? r.muster : [])
        .map((m) => {
          const raw = Array.isArray(m?.schritte) ? m.schritte : [];
          const seen = new Set();
          const schritte = raw.filter((st) => {
            if (!ids.has(st?.eintrag_id) || seen.has(st.eintrag_id)) return false;
            seen.add(st.eintrag_id);
            return true;
          }).map((st) => ({ eintrag_id: st.eintrag_id, kurz: s(st.kurz) })).sort((a, b) => time(a.eintrag_id) - time(b.eintrag_id));
          if (schritte.length < raw.length) fixes.push('Schritt mit unbekanntem Eintrag entfernt.');
          return { titel: s(m?.titel), schritte, deutung: s(m?.deutung), sicherheit: m?.sicherheit === 'mittel' ? 'mittel' : 'schwach' };
        })
        .filter((m) => m.schritte.length >= 2 && (m.titel || m.deutung))
        .slice(0, 3),
      nachdenken: (Array.isArray(r.nachdenken) ? r.nachdenken : [])
        .map((n) => ({ frage: s(n?.frage), bezug: onlyKnown(n?.bezug) }))
        .filter((n) => n.frage)
        .slice(0, 2),
      offen: s(r.offen),
    };
    const record = {
      result,
      check: baseCheck(out.check, [...new Set(fixes)]),
      at: new Date().toISOString(),
      signature,
      count: material.count,
      model: out.model,
    };
    await whenUnlocked(async () => {
      await store.setKV('insights', { ...store.kv('insights'), [cacheKey]: record });
    });
    setJob(key, null);
  } catch (err) {
    console.warn('Mustersuche fehlgeschlagen', err);
    setJob(key, { phase: 'error', error: err, signature, resume: err.resume ? { ...err.resume, material } : null });
  }
}
