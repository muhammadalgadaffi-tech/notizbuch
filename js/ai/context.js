// Stellt das Material für das Modell zusammen – vollständig auf dem Gerät.
// Nur was hier ausgewählt wird, verlässt das Gerät (über api.js oder über die Zwischenablage).
//
// Mit { labels: true } bekommen die Einträge kurze Kennungen ([E1], [E2] …) statt interner ids.
// Das ist für den Weg über das Claude-Abo: Die Kennungen sind lesbar, und die App kann sie in
// Claudes Antwort wieder den richtigen Einträgen zuordnen (refs).

import { store } from '../core/store.js';
import { norm, stems, shorten } from '../core/text.js';
import { THEMEN } from '../core/constants.js';
import { dayDiff, fmtForModel, fmtNowForModel, startOfDay, fmtDateNumeric } from '../core/dates.js';

const TAG_RE = /<\/?\s*(eintrag|neuer_eintrag|fruehere_eintraege|zaehlungen|entwurf|frage|material)[^>]*>/gi;
const clean = (s) => String(s || '').replace(TAG_RE, '');

function cut(text, max) {
  const t = clean(text).trim();
  return t.length > max ? `${t.slice(0, max)} […gekürzt]` : t;
}

/** Kennungen E1, E2 … in zeitlicher Reihenfolge. */
function labelMap(entries) {
  const map = new Map();
  entries.forEach((e, i) => map.set(e.id, `E${i + 1}`));
  return map;
}

/** Ein Eintrag als Textblock für das Modell. */
export function entryBlock(e, now, maxChars = 900, label = null) {
  const lines = [`<eintrag id="${label || e.id}" zeit="${fmtForModel(e.occurredAt, now)}">`];
  if (e.place) lines.push(`Ort: ${clean(e.place)}`);
  const people = store.mentions(e);
  if (people.length) lines.push(`Personen: ${people.map(clean).join(', ')}`);
  if (e.mood) lines.push(`Stimmung: ${e.mood}`);
  if (e.category) lines.push(`Kategorie: ${e.category}`);
  lines.push(`Text: ${cut(e.text, maxChars)}`);
  const answered = e.followUps.filter((f) => f.antwort.trim());
  if (answered.length) {
    lines.push('Rückfragen und Antworten der Person:');
    for (const f of answered) lines.push(`- Frage: ${clean(f.frage)} | Antwort: ${cut(f.antwort, 500)}`);
  }
  lines.push('</eintrag>');
  return lines.join('\n');
}

function scoreAgainst(entry, other, mine) {
  let s = 0;
  const theirs = store.mentionKeys(other);
  for (const k of mine.people) if (theirs.has(k)) s += 6;
  const otherThemes = new Set([other.category, ...other.themes, ...other.suggestions.themes].filter(Boolean));
  for (const t of mine.themes) if (otherThemes.has(t)) s += 2;
  let shared = 0;
  const otherStems = stems(`${other.text} ${other.place}`);
  for (const st of mine.stems) if (otherStems.has(st)) shared++;
  s += Math.min(shared * 1.2, 6);
  if (mine.place && norm(other.place) === mine.place) s += 1;
  if (entry.mood && other.mood === entry.mood) s += 0.5;
  const days = dayDiff(other.occurredAt, entry.occurredAt);
  if (days <= 2) s += 2; else if (days <= 7) s += 1;
  return s;
}

/** Frühere Einträge, die zum neuen Eintrag passen könnten (grobe lokale Vorauswahl). */
export function selectForEntry(entry, limit = 12) {
  const t0 = new Date(entry.occurredAt).getTime();
  const earlier = store.all().filter((e) => e.id !== entry.id && new Date(e.occurredAt).getTime() <= t0);
  const mine = {
    people: store.mentionKeys(entry),
    themes: new Set([entry.category, ...entry.themes, ...entry.suggestions.themes].filter(Boolean)),
    stems: stems(`${entry.text} ${entry.place}`),
    place: norm(entry.place),
  };
  return earlier
    .map((e) => ({ e, s: scoreAgainst(entry, e, mine) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || new Date(b.e.occurredAt) - new Date(a.e.occurredAt))
    .slice(0, limit)
    .map((x) => x.e)
    .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
}

/** Zählungen, die auf dem Gerät exakt berechnet werden (damit das Modell nicht schätzen muss). */
function countsForEntry(entry, now) {
  const lines = [];
  const t0 = new Date(entry.occurredAt).getTime();
  for (const name of store.mentions(entry)) {
    const list = store.entriesWithPerson(name).filter((e) => e.id !== entry.id && new Date(e.occurredAt).getTime() <= t0);
    if (!list.length) {
      lines.push(`- ${clean(name)}: kommt in keinem früheren Eintrag vor.`);
      continue;
    }
    const first = list[list.length - 1];
    const last = list[0];
    lines.push(`- ${clean(name)}: kommt in ${list.length} früheren ${list.length === 1 ? 'Eintrag' : 'Einträgen'} vor (erstmals ${fmtForModel(first.occurredAt, now)}, zuletzt ${fmtForModel(last.occurredAt, now)}).`);
  }
  const total = store.all().filter((e) => e.id !== entry.id).length;
  const recent = store.all().filter((e) => e.id !== entry.id && dayDiff(e.occurredAt, now) <= 14).length;
  lines.push(`- Frühere Einträge im Journal insgesamt: ${total}, davon in den letzten 14 Tagen: ${recent}.`);
  return lines.join('\n');
}

/** Material für die Analyse eines Eintrags. */
export function materialForEntry(entry, now = new Date(), { labels = false } = {}) {
  const context = selectForEntry(entry);
  const lab = labels ? labelMap(context) : null;
  const text = [
    `Heute ist ${fmtNowForModel(now)}.`,
    `Themenliste: ${THEMEN.join(', ')}`,
    '',
    '<neuer_eintrag>',
    entryBlock(entry, now, 6000, labels ? 'NEU' : null),
    '</neuer_eintrag>',
    '',
    '<zaehlungen>',
    countsForEntry(entry, now),
    '</zaehlungen>',
    '',
    `<fruehere_eintraege anzahl="${context.length}" hinweis="auf dem Gerät grob vorausgewählt, nicht alle sind relevant">`,
    ...context.map((e) => entryBlock(e, now, 900, lab?.get(e.id))),
    '</fruehere_eintraege>',
  ].join('\n');
  return { text, contextIds: context.map((e) => e.id), refs: lab ? [...lab].map(([id, l]) => [l, id]) : [] };
}

// ---------- Fragen an das Journal ----------

const NUM = { ein: 1, eine: 1, einen: 1, einem: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwolf: 12 };
const UNIT = { tag: 1, tage: 1, tagen: 1, woche: 7, wochen: 7, monat: 30, monate: 30, monaten: 30, monats: 30 };

/** Erkennt Zeiträume wie „letzten zwei Wochen“, „diese Woche“, „gestern“. */
export function parseRange(question, now = new Date()) {
  const q = norm(question);
  const today = startOfDay(now);
  const daysBack = (n) => ({ from: new Date(today.getTime() - (n - 1) * 86400000), to: now });
  const m = q.match(/(?:letzten|vergangenen|letzte|vergangene|seit)\s+(\d+|[a-z]+)\s+(tag|tage|tagen|woche|wochen|monat|monate|monaten)/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]];
    if (n) return { ...daysBack(Math.min(n * UNIT[m[2]], 366)), label: `letzte ${n * UNIT[m[2]]} Tage` };
  }
  if (/\bheute\b/.test(q)) return { from: today, to: now, label: 'heute' };
  if (/\bgestern\b/.test(q)) return { from: new Date(today.getTime() - 86400000), to: today, label: 'gestern' };
  if (/\b(diese|dieser)\s+woche\b/.test(q)) {
    const dow = (today.getDay() + 6) % 7;
    return { from: new Date(today.getTime() - dow * 86400000), to: now, label: 'diese Woche' };
  }
  if (/\b(letzte|letzten|vergangene|vergangenen)\s+woche\b/.test(q)) return { ...daysBack(7), label: 'letzte 7 Tage' };
  if (/\b(letzten|vergangenen)\s+tage\b/.test(q)) return { ...daysBack(7), label: 'letzte 7 Tage' };
  if (/\b(letzten|vergangenen)\s+wochen\b/.test(q)) return { ...daysBack(21), label: 'letzte 3 Wochen' };
  if (/\b(diesen|diesem|letzten|vergangenen)\s+monat\b/.test(q)) return { ...daysBack(30), label: 'letzte 30 Tage' };
  if (/\bdieses\s+jahr\b/.test(q)) return { from: new Date(now.getFullYear(), 0, 1), to: now, label: 'dieses Jahr' };
  return null;
}

const QUESTION_WORDS = new Set(['aufgefallen', 'auffallen', 'fallt', 'gibt', 'habe', 'hatte', 'mich', 'mein', 'meine', 'meiner', 'meinem', 'meinen', 'uber', 'eintrage', 'eintragen', 'eintrag', 'geschrieben', 'schreibe', 'erwahnt', 'haufig', 'oft', 'zeitraum', 'passiert'].map(norm));

export function materialForQuestion(question, now = new Date(), { labels = false } = {}) {
  const range = parseRange(question, now);
  let pool = store.all();
  if (range) pool = pool.filter((e) => { const t = new Date(e.occurredAt); return t >= range.from && t <= range.to; });

  const qNorm = norm(question);
  const people = store.people().filter((p) => new RegExp(`(^|[^\\p{L}])${p.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(qNorm));
  const qStems = new Set([...stems(question)].filter((s) => !QUESTION_WORDS.has(s) && ![...QUESTION_WORDS].some((w) => w.startsWith(s))));

  const scored = pool.map((e) => {
    let s = 0;
    const keys = store.mentionKeys(e);
    for (const p of people) if (keys.has(p.key)) s += 6;
    const es = stems(`${e.text} ${e.place} ${e.category} ${e.mood} ${e.themes.join(' ')}`);
    for (const st of qStems) if (es.has(st)) s += 2;
    return { e, s };
  });

  let chosen;
  if (range) {
    chosen = scored.length > 60
      ? scored.sort((a, b) => b.s - a.s || new Date(b.e.occurredAt) - new Date(a.e.occurredAt)).slice(0, 60)
      : scored;
  } else {
    const hits = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || new Date(b.e.occurredAt) - new Date(a.e.occurredAt)).slice(0, 40);
    chosen = hits;
    if (hits.length < 10) {
      const ids = new Set(hits.map((x) => x.e.id));
      for (const x of scored) {
        if (chosen.length >= 25) break;
        if (!ids.has(x.e.id)) chosen.push(x);
      }
    }
  }
  const entries = chosen.map((x) => x.e).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const lab = labels ? labelMap(entries) : null;

  const text = [
    `Heute ist ${fmtNowForModel(now)}.`,
    range ? `Zeitraum der Frage (auf dem Gerät erkannt): ${range.label}, ${fmtDateNumeric(range.from)} bis ${fmtDateNumeric(range.to)}.` : 'Kein bestimmter Zeitraum erkannt – Auswahl nach Stichwörtern und Aktualität.',
    `Anzahl ausgewählter Einträge: ${entries.length}`,
    '',
    `<frage>${clean(question).slice(0, 600)}</frage>`,
    '',
    '<material>',
    ...entries.map((e) => entryBlock(e, now, 700, lab?.get(e.id))),
    '</material>',
  ].join('\n');

  return {
    text,
    ids: entries.map((e) => e.id),
    refs: lab ? [...lab].map(([id, l]) => [l, id]) : [],
    basis: {
      count: entries.length,
      from: entries[0]?.occurredAt || null,
      to: entries[entries.length - 1]?.occurredAt || null,
      range: range?.label || null,
    },
  };
}

// ---------- Muster über einen Zeitraum ----------

export function entriesForPatterns({ days, person }, now = new Date()) {
  if (person) return store.entriesWithPerson(person).filter((e) => dayDiff(e.occurredAt, now) <= 120).slice(0, 50);
  const from = new Date(startOfDay(now).getTime() - (days - 1) * 86400000);
  return store.all().filter((e) => new Date(e.occurredAt) >= from).slice(0, 60);
}

export function materialForPatterns({ days, person }, now = new Date(), { labels = false } = {}) {
  const entries = entriesForPatterns({ days, person }, now).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const lab = labels ? labelMap(entries) : null;

  const peopleCount = new Map();
  const themeCount = new Map();
  const moodCount = new Map();
  for (const e of entries) {
    for (const n of store.mentions(e)) peopleCount.set(n, (peopleCount.get(n) || 0) + 1);
    for (const t of new Set([e.category, ...e.themes].filter(Boolean))) themeCount.set(t, (themeCount.get(t) || 0) + 1);
    if (e.mood) moodCount.set(e.mood, (moodCount.get(e.mood) || 0) + 1);
  }
  const fmtCounts = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${clean(k)} (${v})`).join(', ') || 'keine';

  const text = [
    `Heute ist ${fmtNowForModel(now)}.`,
    person
      ? `Fokus: Einträge, in denen ${clean(person)} vorkommt (bis zu 120 Tage zurück).`
      : `Zeitraum: die letzten ${days} Tage.`,
    `Anzahl Einträge: ${entries.length}`,
    '',
    '<zaehlungen>',
    `- Personen (Anzahl Einträge): ${fmtCounts(peopleCount)}`,
    `- Kategorien (Anzahl Einträge): ${fmtCounts(themeCount)}`,
    `- Stimmungen (Anzahl Einträge): ${fmtCounts(moodCount)}`,
    '</zaehlungen>',
    '',
    '<material>',
    ...entries.map((e) => entryBlock(e, now, 600, lab?.get(e.id))),
    '</material>',
  ].join('\n');

  return {
    text,
    ids: entries.map((e) => e.id),
    refs: lab ? [...lab].map(([id, l]) => [l, id]) : [],
    count: entries.length,
    lastEntryAt: entries[entries.length - 1]?.updatedAt || null,
  };
}

export const snippet = (e, n = 90) => shorten(e.text, n);
