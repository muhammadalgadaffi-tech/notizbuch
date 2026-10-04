// Darstellung der Analyse eines Eintrags – und gemeinsame Teile für Suche und Insights.
// Zwei Wege: über das Claude-Abo (Kopieren, kostenlos) oder automatisch mit eigenem Guthaben.

import { h, icon, clear, append, debounce, autoGrow } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtShortDay, fmtTime, fmtAgoDays, fmtStamp } from '../core/dates.js';
import { shorten } from '../core/text.js';
import { analyzeEntry, getJob, isRunning, contentHash } from '../ai/tasks.js';
import { startEntryCopy, copyEntryPrompt, saveEntryAnswer } from '../ai/abo.js';
import { MODELS } from '../ai/api.js';
import { progress } from './components.js';
import { aboBox, renderAboAnswer } from './abo.js';
import { navigate } from '../core/router.js';

const CHECKS = [
  ['fakten_getrennt', 'Fakten und Vermutungen getrennt'],
  ['nichts_erfunden', 'Nichts hinzugedichtet'],
  ['keine_gedankenbehauptung', 'Keine Behauptungen über Gedanken anderer'],
  ['alternativen_offen', 'Andere Erklärungen berücksichtigt'],
  ['kein_scheinzusammenhang', 'Kein Zusammenhang nur wegen Ähnlichkeit'],
  ['gedeckt', 'Durch deine Einträge gedeckt'],
];

export function section(title, content) {
  if (!content || (Array.isArray(content) && !content.length)) return null;
  return h('section', { class: 'an-sec' },
    h('h3', { text: title }),
    typeof content === 'string' ? h('p', { text: content }) : content);
}

/** Aufklappbare Zeile im Fußbereich. */
export function footDetails(summaryText, body) {
  return h('details', {},
    h('summary', {}, icon('chevronRight', 14), summaryText),
    h('div', { class: 'det-body' }, body));
}

/** Ergebnis der Selbstprüfung – dezent, nur auf Wunsch aufgeklappt. */
export function checkDetails(check) {
  if (!check) return null;
  if ('text' in check) {
    // Weg über das Abo: Claude prüft innerhalb derselben Antwort, die App prüft danach Verweise und Namen.
    return footDetails('Selbstprüfung (in Claudes Antwort)', h('ul', {},
      h('li', { text: check.text || 'Claude hat dazu nichts geschrieben.' }),
      (check.lokal || []).map((c) => h('li', { text: `– ${c} (auf dem Gerät)` }))));
  }
  const changes = [...(check.korrekturen || []), ...(check.lokal || [])];
  const title = changes.length
    ? `Selbstprüfung · ${changes.length} ${changes.length === 1 ? 'Anpassung' : 'Anpassungen'}`
    : 'Selbstprüfung · keine Anpassung nötig';
  return footDetails(title, h('ul', {},
    CHECKS.map(([k, text]) => h('li', { class: check[k] === false ? 'check-no' : 'check-ok', text: `${check[k] === false ? '✗' : '✓'} ${text}` })),
    changes.length ? h('li', { class: 'muted', text: 'Geändert:' }) : null,
    (check.korrekturen || []).map((c) => h('li', { text: `– ${c}` })),
    (check.lokal || []).map((c) => h('li', { text: `– ${c} (auf dem Gerät)` }))));
}

/** Liste der Einträge, die mitgeschickt wurden. */
export function basisDetails(title, ids) {
  const entries = ids.map((id) => store.get(id)).filter(Boolean);
  return footDetails(title, h('ul', {},
    entries.length
      ? entries.map((e) => h('li', {}, h('a', { href: `#/eintrag/${encodeURIComponent(e.id)}`, text: `${fmtShortDay(e.occurredAt)}, ${fmtTime(e.occurredAt)}` }), ` – ${shorten(e.text, 70)}`))
      : h('li', { text: 'Keine weiteren Einträge.' })));
}

export function modelName(id) {
  if (id === 'claude-abo') return 'über dein Claude-Abo';
  return MODELS[id]?.name || id || '';
}

/** Verweis-Karte auf einen anderen Eintrag. */
export function entryCard(e, note) {
  const day = fmtShortDay(e.occurredAt);
  const ago = fmtAgoDays(e.occurredAt);
  return h('a', { class: 'link-card', href: `#/eintrag/${encodeURIComponent(e.id)}` },
    h('div', { class: 'lc-meta', text: `${day}, ${fmtTime(e.occurredAt)}${ago !== day ? ` · ${ago}` : ''}` }),
    h('div', { class: 'lc-text', text: e.text }),
    note ? h('div', { class: 'lc-note', text: note }) : null);
}

export function errorCallout(err, onRetry) {
  const needsSettings = ['nokey', 'auth', 'billing', 'model', 'permission'].includes(err?.kind);
  return h('div', { class: 'callout', role: 'alert' },
    h('p', { text: err?.message || 'Etwas ist schiefgelaufen.' }),
    h('div', { class: 'actions' },
      onRetry ? h('button', { class: 'btn btn-secondary grow', type: 'button', onClick: onRetry }, 'Erneut versuchen') : null,
      needsSettings ? h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => navigate('#/einstellungen') }, 'Einstellungen') : null));
}

/** „Eintrag und 5 frühere“ – was mitgeschickt wird. */
export function basisText(n) {
  return n ? `dein Eintrag und ${n} ${n === 1 ? 'früherer' : 'frühere'}` : 'nur dein Eintrag';
}

/** Wartet ein kopierter Auftrag noch auf Claudes Antwort? */
export function waitingForAbo(entry) {
  const r = entry.aboRequest;
  return !!r && (!entry.analysis || new Date(r.at) > new Date(entry.analysis.at));
}

/** Analyse starten – je nach Einstellung kopieren (kostenlos) oder automatisch. Direkt beim Antippen aufrufen. */
export function startAnalysis(entry) {
  if (store.aiMode === 'abo') startEntryCopy(entry.id);
  else analyzeEntry(entry.id);
}

export function analysisSignature(entry) {
  const job = getJob(`analyse:${entry.id}`);
  const stale = entry.analysis ? entry.analysis.contentHash !== contentHash(entry) : false;
  return [entry.analysis?.at || '', stale, job?.phase || '', !!store.settings.apiKey, store.aiMode, entry.aboRequest?.at || ''].join('|');
}

/** Füllt `container` mit dem aktuellen Stand der Analyse. */
export function renderAnalysis(container, entry) {
  clear(container);
  const key = `analyse:${entry.id}`;
  const job = getJob(key);
  const a = entry.analysis;
  const abo = store.aiMode === 'abo';

  container.append(h('div', { class: 'an-head' }, h('h2', { class: 'an-title', text: 'Analyse' })));

  if (isRunning(key)) {
    container.append(job.phase === 'review'
      ? progress('Prüfe die Analyse …', 'Fakten, Vermutungen und Zusammenhänge werden gegengeprüft.')
      : progress('Denke über den Eintrag nach …', 'Frühere Einträge werden einbezogen. Das dauert meist 20 bis 60 Sekunden.'));
    return;
  }

  if (job?.phase === 'error') {
    container.append(errorCallout(job.error, () => analyzeEntry(entry.id)));
    if (!a) return;
  }

  if (abo && waitingForAbo(entry)) {
    container.append(aboBox({
      copyKey: `entry:${entry.id}`,
      what: basisText(entry.aboRequest.refs.length),
      onCopy: () => startEntryCopy(entry.id),
      onSave: (text) => saveEntryAnswer(entry.id, text),
      onCancel: () => store.update(entry.id, (e) => { e.aboRequest = null; }),
    }));
    if (!a) return;
    container.append(h('p', { class: 'small muted abo-old', text: 'Bisherige Analyse:' }));
  }

  if (!a) {
    if (abo) {
      container.append(h('div', { class: 'callout' },
        h('p', { text: 'Noch nicht analysiert.' }),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => startEntryCopy(entry.id) }, 'Analysieren'),
        h('p', { class: 'help', text: 'Kostenlos über dein Claude-Abo: Die App kopiert den Auftrag, du fügst ihn in Claude ein und die Antwort hier zurück.' })));
    } else if (!store.settings.apiKey) {
      container.append(h('div', { class: 'callout' },
        h('p', { text: 'Für die automatische Analyse fehlt ein API-Schlüssel. Dein Eintrag ist gespeichert.' }),
        h('a', { class: 'btn btn-secondary btn-block', href: '#/einstellungen' }, 'Einrichten'),
        h('button', { class: 'btn btn-quiet btn-block', type: 'button', onClick: () => store.setSettings({ mode: 'abo' }) }, 'Stattdessen kostenlos über dein Claude-Abo')));
    } else {
      container.append(h('div', { class: 'callout' },
        h('p', { text: 'Noch nicht analysiert.' }),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => analyzeEntry(entry.id) }, 'Analysieren')));
    }
    return;
  }

  if (a.contentHash !== contentHash(entry) && !(abo && waitingForAbo(entry))) {
    container.append(h('div', { class: 'callout' },
      h('p', { text: 'Du hast den Eintrag nach dieser Analyse geändert.' }),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => startAnalysis(entry) }, 'Neu analysieren')));
  }

  if (a.mode === 'abo') renderAboBody(container, entry, a);
  else renderApiBody(container, entry, a);
}

function footer(entry, a) {
  const n = (a.contextIds || []).filter((id) => store.get(id)).length;
  return h('div', { class: 'an-foot' },
    checkDetails(a.check),
    basisDetails(n ? `Grundlage: dieser Eintrag und ${n} ${n === 1 ? 'früherer' : 'frühere'}` : 'Grundlage: nur dieser Eintrag', a.contextIds || []),
    h('div', { class: 'chips chips-below' },
      h('span', { text: `${fmtStamp(a.at)} · ${modelName(a.model)}` }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => startAnalysis(entry) }, 'Neu analysieren')));
}

/** Antwort aus dem Claude-Abo (Text mit Überschriften). */
function renderAboBody(container, entry, a) {
  const { nodes, reflect, special } = renderAboAnswer(a.text, a.refs, { splitReflect: true });
  append(container, nodes);
  if (special.rueckfragen.length) container.append(questions(entry, special.rueckfragen));
  if (reflect.length) container.append(h('div', { class: 'reflect' }, reflect));
  container.append(footer(entry, a));
}

/** Antwort aus der automatischen Analyse (feste Felder). */
function renderApiBody(container, entry, a) {
  const r = a.result;
  if (r.hinweis) container.append(h('div', { class: 'note', role: 'note', text: r.hinweis }));

  append(container, [
    section('Was passiert ist', r.beobachtung),
    section('Was dir aufgefallen ist', r.wahrnehmung),
    section('Mögliche Erklärungen', r.erklaerungen.length
      ? h('ol', { class: 'an-list' }, r.erklaerungen.map((x) => h('li', {}, `${x.text} `, h('span', { class: 'kind', text: x.einordnung }))))
      : null),
    section('Was offen bleibt', r.offen),
  ]);

  const links = r.verbindungen
    .map((v) => ({ v, e: store.get(v.eintrag_id) }))
    .filter((x) => x.e);
  if (links.length) {
    container.append(section('Verbindung zu früher', h('div', {},
      links.map(({ v, e }) => h('div', {}, h('p', { text: v.text }), entryCard(e))))));
  }

  if (r.rueckfragen.length) container.append(questions(entry, r.rueckfragen));

  const reflect = [
    section('Andere Perspektive', r.perspektive),
    section('Was du vielleicht übersiehst', r.uebersehen),
    section('Zum Nachdenken', r.denkfrage),
  ].filter(Boolean);
  if (reflect.length) container.append(h('div', { class: 'reflect' }, reflect));

  container.append(footer(entry, a));
}

/** Rückfragen mit Antwortfeldern. Antworten werden verschlüsselt beim Eintrag gespeichert. */
function questions(entry, list) {
  const answers = new Map(entry.followUps.map((f) => [f.frage, f.antwort]));
  const button = h('button', { class: 'btn btn-secondary btn-block', type: 'button' }, list.length === 1 ? 'Mit Antwort neu analysieren' : 'Mit Antworten neu analysieren');
  const pendingSaves = [];

  const refresh = () => { button.disabled = ![...answers.values()].some((v) => v && v.trim()); };

  const fields = list.map((q) => {
    const ta = h('textarea', { class: 'textarea', rows: 1, placeholder: 'Antwort (optional)', 'aria-label': `Antwort auf: ${q}`, value: answers.get(q) || '' });
    autoGrow(ta);
    const save = debounce(() => {
      const value = ta.value;
      pendingSaves.push(store.update(entry.id, (e) => {
        const f = e.followUps.find((x) => x.frage === q);
        if (f) f.antwort = value; else e.followUps.push({ frage: q, antwort: value });
      }));
    }, 400);
    ta.addEventListener('input', () => { answers.set(q, ta.value); refresh(); save(); });
    ta.addEventListener('blur', () => save.flush());
    return { q, ta, save };
  });

  button.addEventListener('click', () => {
    for (const f of fields) f.save.flush();
    if (store.aiMode === 'abo') {
      // Sofort kopieren (iOS erlaubt das nur direkt beim Antippen) – mit den gerade getippten Antworten.
      const current = structuredClone(store.get(entry.id) || entry);
      for (const [q, v] of answers) {
        const f = current.followUps.find((x) => x.frage === q);
        if (f) f.antwort = v; else current.followUps.push({ frage: q, antwort: v });
      }
      const request = copyEntryPrompt(current);
      Promise.allSettled(pendingSaves)
        .then(() => store.update(entry.id, (e) => { e.aboRequest = request; }))
        .then(() => requestAnimationFrame(() => document.querySelector('.abo-box')?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
    } else {
      Promise.allSettled(pendingSaves).then(() => analyzeEntry(entry.id));
    }
  });
  refresh();

  return h('section', { class: 'an-sec' },
    h('h3', { text: list.length === 1 ? 'Eine Sache würde helfen' : 'Ein paar Dinge würden helfen' }),
    fields.map((f) => h('div', { class: 'question' }, h('p', { class: 'q', text: f.q }), f.ta)),
    h('div', { class: 'actions' }, button));
}
