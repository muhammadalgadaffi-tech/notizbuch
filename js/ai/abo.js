// Analyse über das eigene Claude-Abo – kostet nichts extra.
//
// Ablauf: Die App stellt den Auftrag zusammen (Regeln + Eintrag + ausgewählte frühere Einträge)
// und legt ihn in die Zwischenablage. Du fügst ihn in der Claude-App ein, kopierst die Antwort
// und fügst sie hier wieder ein. Die App zerlegt sie in Abschnitte und speichert sie verschlüsselt.
//
// Die App selbst schickt dabei nichts ins Internet. Was in der Zwischenablage landet, ist genau
// der Text, den du in Claude einfügst – du siehst also selbst, was Claude bekommt.

import { store, normalizeEntry, makeId } from '../core/store.js';
import { norm, uniqueCaseless } from '../core/text.js';
import { THEMEN } from '../core/constants.js';
import { materialForEntry, materialForQuestion, materialForPatterns } from './context.js';
import { ABO_ANALYSE, ABO_FRAGE, ABO_MUSTER, ABO_MARKE, aboAuftrag } from './prompts.js';
import { contentHash, analysisHash, patternKey, patternSignature } from './tasks.js';

export const CLAUDE_URL = 'https://claude.ai/new';

// ---------- Zwischenablage ----------

const copies = new Map(); // Schlüssel → { status: 'pending'|'ok'|'failed', promise, at }

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Text kopieren. Muss direkt beim Antippen aufgerufen werden (Vorgabe von iOS). */
export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

function trackCopy(key, text) {
  const entry = { status: 'pending', at: Date.now(), text };
  entry.promise = copyText(text).then((ok) => { entry.status = ok ? 'ok' : 'failed'; return ok; });
  copies.set(key, entry);
  return entry;
}

/** Stand des letzten Kopierens in dieser Sitzung (für die Anzeige „kopiert ✓“). */
export function copyState(key) {
  return copies.get(key) || null;
}

// ---------- Aufträge bauen und kopieren ----------

export function entryPrompt(entry) {
  const m = materialForEntry(entry, new Date(), { labels: true });
  return { text: aboAuftrag('Analyse eines Eintrags', ABO_ANALYSE, m.text), refs: m.refs };
}

/** Kopiert den Auftrag für einen Eintrag und liefert den Vermerk, der am Eintrag gespeichert wird. */
export function copyEntryPrompt(entryLike) {
  const entry = normalizeEntry(entryLike);
  const p = entryPrompt(entry);
  trackCopy(`entry:${entry.id}`, p.text);
  return { refs: p.refs, at: new Date().toISOString(), contentHash: contentHash(entry), chars: p.text.length };
}

/** Kopiert erneut und speichert den Vermerk am Eintrag. */
export async function startEntryCopy(id) {
  const entry = store.get(id);
  if (!entry) return;
  const request = copyEntryPrompt(entry);
  await store.update(id, (e) => { e.aboRequest = request; });
}

export function copyQuestionPrompt(question) {
  const m = materialForQuestion(question, new Date(), { labels: true });
  if (!m.ids.length) return { empty: true, basis: m.basis };
  const text = aboAuftrag('Frage an mein Journal', ABO_FRAGE, m.text);
  trackCopy('frage', text);
  const pending = { frage: question, refs: m.refs, ids: m.ids, basis: m.basis, at: new Date().toISOString(), chars: text.length };
  store.setKV('aboPending', { ...(store.kv('aboPending') || {}), frage: pending }).catch(() => {});
  return pending;
}

export function copyPatternsPrompt(opts) {
  const m = materialForPatterns(opts, new Date(), { labels: true });
  const key = patternKey(opts);
  const text = aboAuftrag(opts.person ? `Muster mit ${opts.person}` : `Muster der letzten ${opts.days} Tage`, ABO_MUSTER, m.text);
  trackCopy(`muster:${key}`, text);
  const pending = { refs: m.refs, count: m.count, signature: patternSignature(opts), at: new Date().toISOString(), chars: text.length };
  const all = store.kv('aboPending') || {};
  store.setKV('aboPending', { ...all, muster: { ...(all.muster || {}), [key]: pending } }).catch(() => {});
  return pending;
}

export function pendingQuestion() {
  return store.kv('aboPending')?.frage || null;
}

export function pendingPatterns(opts) {
  return store.kv('aboPending')?.muster?.[patternKey(opts)] || null;
}

export async function cancelPending(kind, opts) {
  const all = { ...(store.kv('aboPending') || {}) };
  if (kind === 'frage') delete all.frage;
  if (kind === 'muster') {
    all.muster = { ...(all.muster || {}) };
    delete all.muster[patternKey(opts)];
  }
  await store.setKV('aboPending', all);
}

// ---------- Antwort einlesen ----------

const HEADINGS = [
  'Was passiert ist', 'Was dir aufgefallen ist', 'Mögliche Erklärungen', 'Was offen bleibt', 'Verbindung zu früher',
  'Rückfragen', 'Andere Perspektive', 'Was du vielleicht übersiehst', 'Zum Nachdenken', 'Hinweis', 'Personen', 'Themen',
  'Selbstprüfung', 'Antwort', 'Worauf sich das stützt', 'Mögliches Muster', 'Mögliche Muster',
];
const headKey = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
const HEAD_KEYS = new Map(HEADINGS.map((t) => [headKey(t), t]));

function cleanHeading(s) {
  return s.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/[:：]\s*$/, '').trim();
}

/** Prüft, ob der eingefügte Text wie eine Antwort aussieht. Gibt eine Fehlermeldung oder null zurück. */
export function checkPasted(raw) {
  const t = String(raw || '').trim();
  if (t.length < 20) return 'Das ist zu kurz für eine Antwort. Kopiere in Claude die ganze Antwort.';
  if (t.includes(ABO_MARKE) || t.includes('=== Rolle und Regeln ===')) {
    return 'Das ist der kopierte Auftrag, nicht Claudes Antwort. Kopiere in Claude die Antwort (unter der Antwort auf „Kopieren“ tippen).';
  }
  return null;
}

/** Zerlegt Claudes Antwort in Abschnitte. Unbekannte Überschriften bleiben als eigene Abschnitte erhalten. */
export function parseAnswer(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let cur = { title: null, lines: [] };
  const push = () => { if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur); };
  for (const line of lines) {
    const t = line.trim();
    let title = null;
    const md = /^#{1,2}\s+(.+)$/.exec(t);
    if (md) title = cleanHeading(md[1]);
    else if (t.length <= 45) {
      const k = headKey(cleanHeading(t));
      if (HEAD_KEYS.has(k)) title = HEAD_KEYS.get(k);
    }
    if (title !== null) {
      push();
      cur = { title: HEAD_KEYS.get(headKey(title)) || title, lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  push();
  const content = sections.filter((s) => s.lines.some((l) => l.trim()));
  const get = (name) => content.find((s) => s.title === name);
  const text = (s) => (s ? s.lines.map((l) => l.trim()).filter(Boolean).join('\n') : '');
  const items = (s) => (s ? s.lines.map((l) => l.trim().replace(/^(?:[-*•–]|\d+[.)])\s+/, '')).filter(Boolean) : []);
  return {
    sections: content,
    special: {
      personen: text(get('Personen')),
      themen: text(get('Themen')),
      selbstpruefung: text(get('Selbstprüfung')),
      hinweis: text(get('Hinweis')),
      rueckfragen: items(get('Rückfragen')).slice(0, 3),
    },
  };
}

function splitList(s) {
  return String(s || '')
    .split(/[,;\n]/)
    .map((x) => x.replace(/^(?:[-*•–]|\d+[.)])\s+/, '').replace(/\*\*/g, '').replace(/[.]$/, '').trim())
    .filter((x) => x && x.length <= 40);
}

/** Verweise wie [E3] in einem Text, die nicht zu einem mitgeschickten Eintrag passen. */
export function unknownRefs(raw, refs) {
  const known = new Set(refs.map((r) => r[0]));
  const found = new Set();
  for (const m of String(raw).matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)) {
    for (const l of m[1].split(/\s*,\s*/)) if (!known.has(l)) found.add(l);
  }
  return [...found];
}

/** Antwort zu einem Eintrag speichern. */
export async function saveEntryAnswer(id, raw) {
  const entry = store.get(id);
  if (!entry) throw new Error('Eintrag nicht gefunden.');
  const problem = checkPasted(raw);
  if (problem) throw new Error(problem);
  const parsed = parseAnswer(raw);
  const refs = entry.aboRequest?.refs || [];
  const textNorm = norm(entry.text);
  const personen = uniqueCaseless(splitList(parsed.special.personen).filter((p) => textNorm.includes(norm(p))));
  const themen = splitList(parsed.special.themen)
    .map((t) => THEMEN.find((x) => norm(x) === norm(t)))
    .filter(Boolean);
  const fixes = [];
  if (splitList(parsed.special.personen).length > personen.length) fixes.push('Name entfernt, der nicht wörtlich im Eintrag steht.');
  if (unknownRefs(raw, refs).length) fixes.push('Verweis auf einen nicht mitgeschickten Eintrag wird nicht verlinkt.');

  await store.update(id, (e) => {
    e.analysis = {
      mode: 'abo',
      text: String(raw).trim(),
      refs,
      contextIds: refs.map((r) => r[1]),
      at: new Date().toISOString(),
      contentHash: e.aboRequest?.contentHash || contentHash(e),
      hash: analysisHash(e),
      model: 'claude-abo',
      check: { text: parsed.special.selbstpruefung, lokal: fixes },
    };
    const known = new Set([...store.mentionKeys(e), ...e.people.map((p) => norm(p).trim())]);
    e.suggestions.people = personen.filter((p) => !known.has(norm(p).trim()));
    e.suggestions.themes = [...new Set(themen)].filter((t) => t !== e.category && !e.themes.includes(t));
    e.followUps = e.followUps.filter((f) => f.antwort.trim());
    e.aboRequest = null;
  });
}

/** Antwort auf eine Frage speichern. Gibt den gespeicherten Datensatz zurück. */
export async function saveQuestionAnswer(raw) {
  const pending = pendingQuestion();
  if (!pending) throw new Error('Es wartet keine Frage auf eine Antwort.');
  const problem = checkPasted(raw);
  if (problem) throw new Error(problem);
  const parsed = parseAnswer(raw);
  const record = {
    mode: 'abo',
    id: makeId(),
    frage: pending.frage,
    at: new Date().toISOString(),
    text: String(raw).trim(),
    refs: pending.refs,
    ids: pending.ids,
    basis: pending.basis,
    model: 'claude-abo',
    check: { text: parsed.special.selbstpruefung, lokal: unknownRefs(raw, pending.refs).length ? ['Verweis auf einen nicht mitgeschickten Eintrag wird nicht verlinkt.'] : [] },
  };
  const list = [record, ...store.kv('questions').filter((q) => q.frage !== pending.frage)].slice(0, 20);
  await store.setKV('questions', list);
  await cancelPending('frage');
  return record;
}

/** Antwort zur Mustersuche speichern. */
export async function savePatternsAnswer(opts, raw) {
  const pending = pendingPatterns(opts);
  if (!pending) throw new Error('Es wartet keine Mustersuche auf eine Antwort.');
  const problem = checkPasted(raw);
  if (problem) throw new Error(problem);
  const parsed = parseAnswer(raw);
  const record = {
    mode: 'abo',
    text: String(raw).trim(),
    refs: pending.refs,
    at: new Date().toISOString(),
    signature: pending.signature,
    count: pending.count,
    model: 'claude-abo',
    check: { text: parsed.special.selbstpruefung, lokal: unknownRefs(raw, pending.refs).length ? ['Verweis auf einen nicht mitgeschickten Eintrag wird nicht verlinkt.'] : [] },
  };
  await store.setKV('insights', { ...store.kv('insights'), [patternKey(opts)]: record });
  await cancelPending('muster', opts);
}
