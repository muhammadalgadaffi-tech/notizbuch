// Zentrale Datenhaltung: entschlüsselte Einträge im Arbeitsspeicher, verschlüsselt auf dem Gerät.

import { db } from './db.js';
import { createVault, openVault, changeVaultCode, seal, unseal } from './crypto.js';
import { norm, nameRegex, uniqueCaseless } from './text.js';
import { THEMEN } from './constants.js';
import { DEFAULT_MODEL } from '../ai/api.js';

const KV_DEFAULTS = {
  settings: () => ({ apiKey: '', model: DEFAULT_MODEL }),
  usage: () => ({}),
  insights: () => ({}),
  questions: () => [],
  draft: () => null,
  aboPending: () => ({}),
};

const state = {
  key: null,
  entries: new Map(),
  kv: new Map(),
  derived: null,
};

const listeners = new Map();
const writeQueues = new Map();

function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (err) { console.error(err); }
  }
}

function queue(id, job) {
  const prev = writeQueues.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  writeQueues.set(id, next);
  next.finally(() => { if (writeQueues.get(id) === next) writeQueues.delete(id); });
  return next;
}

function requireKey() {
  if (!state.key) throw new Error('Notizbuch ist gesperrt.');
  return state.key;
}

export function makeId() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `e${Date.now().toString(36)}${[...r].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8)}`;
}

/** Füllt fehlende Felder auf – auch für importierte oder ältere Einträge. */
export function normalizeEntry(e) {
  const now = new Date().toISOString();
  return {
    id: String(e.id || makeId()),
    text: String(e.text || ''),
    createdAt: e.createdAt || now,
    updatedAt: e.updatedAt || e.createdAt || now,
    occurredAt: e.occurredAt || e.createdAt || now,
    people: uniqueCaseless(Array.isArray(e.people) ? e.people.map(String) : []),
    place: String(e.place || ''),
    mood: e.mood ? String(e.mood) : '',
    category: e.category ? String(e.category) : '',
    themes: uniqueCaseless(Array.isArray(e.themes) ? e.themes.map(String) : []),
    suggestions: {
      people: uniqueCaseless(Array.isArray(e.suggestions?.people) ? e.suggestions.people.map(String) : []),
      themes: uniqueCaseless(Array.isArray(e.suggestions?.themes) ? e.suggestions.themes.map(String) : []),
    },
    followUps: Array.isArray(e.followUps)
      ? e.followUps.filter((f) => f && f.frage).map((f) => ({ frage: String(f.frage), antwort: String(f.antwort || '') }))
      : [],
    analysis: e.analysis && typeof e.analysis === 'object' ? e.analysis : null,
    // Auftrag, der für das Claude-Abo kopiert wurde und auf eine Antwort wartet
    aboRequest: e.aboRequest && Array.isArray(e.aboRequest.refs) ? e.aboRequest : null,
  };
}

/** Bekannte Namen, die in einem Eintrag vorkommen (eingetragen oder wörtlich im Text). */
function computeMentionKeys(e, canon) {
  const keys = new Set(e.people.map((p) => norm(p).trim()).filter(Boolean));
  const nt = norm(e.text);
  for (const k of canon.keys()) if (!keys.has(k) && nameRegex(k).test(nt)) keys.add(k);
  return keys;
}

// ---------- Abgeleitete Werte (Personen, Themen) ----------

function derive() {
  if (state.derived) return state.derived;
  const asc = [...state.entries.values()].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const desc = [...asc].reverse();

  // Bekannte Personen: alles, was du selbst eingetragen oder bestätigt hast.
  const canon = new Map();
  for (const e of asc) for (const p of e.people) {
    const k = norm(p).trim();
    if (k && !canon.has(k)) canon.set(k, p.trim());
  }

  // Erwähnungen: eingetragene Personen + bekannte Namen, die wörtlich im Text stehen.
  const mentions = new Map();
  for (const e of asc) mentions.set(e.id, computeMentionKeys(e, canon));

  state.derived = { asc, desc, canon, mentions };
  return state.derived;
}

function invalidate() {
  state.derived = null;
}

// ---------- Öffentliche Schnittstelle ----------

export const store = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit,

  get unlocked() { return !!state.key; },

  async hasVault() {
    return !!(await db.get('meta', 'vault'));
  },

  async create(code) {
    const { vault, key } = await createVault(code);
    await db.put('meta', 'vault', vault);
    state.key = key;
    state.entries.clear();
    state.kv.clear();
    invalidate();
    emit('unlock');
  },

  async unlock(code) {
    const vault = await db.get('meta', 'vault');
    if (!vault) throw new Error('Kein Notizbuch gefunden.');
    const key = await openVault(vault, code);
    const [entryRows, kvRows] = await Promise.all([db.entries('entries'), db.entries('kv')]);
    const entries = new Map();
    for (const [id, rec] of entryRows) {
      try { entries.set(id, normalizeEntry(await unseal(key, rec, `entry:${id}`))); } catch (err) { console.warn('Eintrag nicht lesbar', id, err); }
    }
    const kv = new Map();
    for (const [name, rec] of kvRows) {
      try { kv.set(name, await unseal(key, rec, `kv:${name}`)); } catch (err) { console.warn('Wert nicht lesbar', name, err); }
    }
    state.key = key;
    state.entries = entries;
    state.kv = kv;
    invalidate();
    emit('unlock');
  },

  lock() {
    state.key = null;
    state.entries = new Map();
    state.kv = new Map();
    invalidate();
    emit('lock');
  },

  async changeCode(oldCode, newCode) {
    const vault = await db.get('meta', 'vault');
    const next = await changeVaultCode(vault, oldCode, newCode);
    await db.put('meta', 'vault', next);
  },

  /** Rohdaten für ein verschlüsseltes Backup (unverändert, so wie sie gespeichert sind). */
  async rawDump() {
    const [vault, entries, kv] = await Promise.all([db.get('meta', 'vault'), db.entries('entries'), db.entries('kv')]);
    return { vault, entries, kv };
  },

  async wipe() {
    state.key = null;
    state.entries = new Map();
    state.kv = new Map();
    invalidate();
    await db.destroy();
  },

  // ----- Einträge -----

  all() { return derive().desc; },
  count() { return state.entries.size; },
  get(id) { return state.entries.get(id) || null; },

  async save(entry) {
    const key = requireKey();
    const e = normalizeEntry({ ...entry, updatedAt: new Date().toISOString() });
    state.entries.set(e.id, e);
    invalidate();
    emit('entries', { id: e.id });
    emit(`entry:${e.id}`, e);
    await queue(e.id, async () => db.put('entries', e.id, await seal(key, e, `entry:${e.id}`)));
    return e;
  },

  /** Ändert den aktuellen Stand eines Eintrags (sicher gegen gleichzeitige Änderungen). */
  async update(id, mutate) {
    const current = state.entries.get(id);
    if (!current) return null;
    const draft = structuredClone(current);
    const result = mutate(draft) || draft;
    return this.save(result);
  },

  async remove(id) {
    requireKey();
    state.entries.delete(id);
    invalidate();
    emit('entries', { id, removed: true });
    emit(`entry:${id}`, null);
    await queue(id, () => db.del('entries', id));
  },

  /** Einträge übernehmen (Import). Bereits vorhandene gleiche Einträge werden nur ersetzt, wenn neuer. */
  async importEntries(list) {
    const key = requireKey();
    let added = 0; let updated = 0; let skipped = 0;
    const ops = [];
    for (const raw of list) {
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) { skipped++; continue; }
      const e = normalizeEntry(raw);
      const existing = state.entries.get(e.id);
      if (existing) {
        if (new Date(e.updatedAt) > new Date(existing.updatedAt)) updated++;
        else { skipped++; continue; }
      } else added++;
      state.entries.set(e.id, e);
      ops.push({ store: 'entries', key: e.id, value: await seal(key, e, `entry:${e.id}`) });
    }
    await db.batch(ops);
    invalidate();
    emit('entries', {});
    return { added, updated, skipped };
  },

  // ----- Weitere Werte (Einstellungen, Zwischenstände) -----

  kv(name) {
    if (state.kv.has(name)) return state.kv.get(name);
    return KV_DEFAULTS[name] ? KV_DEFAULTS[name]() : null;
  },

  async setKV(name, value) {
    const key = requireKey();
    state.kv.set(name, value);
    emit(`kv:${name}`, value);
    await queue(`kv:${name}`, async () => db.put('kv', name, await seal(key, value, `kv:${name}`)));
  },

  get settings() { return { ...KV_DEFAULTS.settings(), ...(this.kv('settings') || {}) }; },
  async setSettings(patch) { await this.setKV('settings', { ...this.settings, ...patch }); },

  // ----- Personen, Themen, Orte -----

  /** Namen (Anzeigeform), die in einem Eintrag vorkommen. */
  mentions(entry) {
    const d = derive();
    const keys = this.mentionKeys(entry);
    return [...keys].map((k) => d.canon.get(k) || entry.people.find((p) => norm(p).trim() === k) || k);
  },

  mentionKeys(entry) {
    const d = derive();
    const stored = state.entries.get(entry.id);
    // Gespeicherter, unveränderter Eintrag: vorberechnet. Sonst (z. B. noch nicht gespeichert): neu berechnen.
    if (stored === entry && d.mentions.has(entry.id)) return d.mentions.get(entry.id);
    return computeMentionKeys(entry, d.canon);
  },

  /** Weg der Analyse: 'abo' (kostenlos, über die Zwischenablage) oder 'api' (eigenes Guthaben). */
  get aiMode() {
    return this.settings.mode === 'api' ? 'api' : 'abo';
  },

  displayName(nameOrKey) {
    const k = norm(nameOrKey).trim();
    return derive().canon.get(k) || nameOrKey;
  },

  /** Alle bekannten Personen mit Anzahl der Einträge. */
  people() {
    const d = derive();
    const stats = new Map();
    for (const e of d.asc) {
      for (const k of d.mentions.get(e.id) || []) {
        if (!d.canon.has(k)) continue;
        const s = stats.get(k) || { key: k, name: d.canon.get(k), count: 0, first: e.occurredAt, last: e.occurredAt };
        s.count += 1;
        s.last = e.occurredAt;
        stats.set(k, s);
      }
    }
    return [...stats.values()].sort((a, b) => b.count - a.count || new Date(b.last) - new Date(a.last));
  },

  entriesWithPerson(nameOrKey) {
    const k = norm(nameOrKey).trim();
    const d = derive();
    return d.desc.filter((e) => d.mentions.get(e.id)?.has(k));
  },

  /** Von der Analyse vorgeschlagene, noch nicht bestätigte Personen. */
  pendingPeople() {
    const d = derive();
    const map = new Map();
    for (const e of d.desc) {
      for (const p of e.suggestions.people) {
        const k = norm(p).trim();
        if (!k || d.canon.has(k)) continue;
        const s = map.get(k) || { key: k, name: p, ids: [] };
        s.ids.push(e.id);
        map.set(k, s);
      }
    }
    return [...map.values()].sort((a, b) => b.ids.length - a.ids.length);
  },

  /** Person bestätigen: überall, wo sie vorgeschlagen wurde, als Person übernehmen. */
  async confirmPerson(name) {
    const k = norm(name).trim();
    const ids = this.all().filter((e) => e.suggestions.people.some((p) => norm(p).trim() === k)).map((e) => e.id);
    for (const id of ids) {
      await this.update(id, (e) => {
        e.people = uniqueCaseless([...e.people, name]);
        e.suggestions.people = e.suggestions.people.filter((p) => norm(p).trim() !== k);
      });
    }
  },

  /** Themen mit bestätigter Anzahl und zusätzlich vermuteter Anzahl. */
  themes() {
    const out = [];
    for (const t of THEMEN) {
      let confirmed = 0; let suggested = 0;
      for (const e of this.all()) {
        if (e.category === t || e.themes.includes(t)) confirmed++;
        else if (e.suggestions.themes.includes(t)) suggested++;
      }
      if (confirmed || suggested) out.push({ name: t, confirmed, suggested });
    }
    return out.sort((a, b) => b.confirmed - a.confirmed || b.suggested - a.suggested);
  },

  /** Häufige Orte, für schnelle Auswahl. */
  places(limit = 5) {
    const counts = new Map();
    for (const e of this.all().slice(0, 80)) {
      const p = e.place.trim();
      if (!p) continue;
      const k = norm(p);
      const c = counts.get(k) || { name: p, n: 0 };
      c.n += 1;
      counts.set(k, c);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.name);
  },
};
