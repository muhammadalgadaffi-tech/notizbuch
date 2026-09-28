// Darstellung der Analyse eines Eintrags – und gemeinsame Teile für Suche und Insights.

import { h, icon, clear, append, debounce, autoGrow } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtShortDay, fmtTime, fmtAgoDays, fmtStamp } from '../core/dates.js';
import { shorten } from '../core/text.js';
import { analyzeEntry, getJob, isRunning, contentHash } from '../ai/tasks.js';
import { MODELS } from '../ai/api.js';
import { progress } from './components.js';
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

export function analysisSignature(entry) {
  const job = getJob(`analyse:${entry.id}`);
  const stale = entry.analysis ? entry.analysis.contentHash !== contentHash(entry) : false;
  return [entry.analysis?.at || '', stale, job?.phase || '', !!store.settings.apiKey].join('|');
}

/** Füllt `container` mit dem aktuellen Stand der Analyse. */
export function renderAnalysis(container, entry) {
  clear(container);
  const key = `analyse:${entry.id}`;
  const job = getJob(key);
  const a = entry.analysis;

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

  if (!a) {
    if (!store.settings.apiKey) {
      container.append(h('div', { class: 'callout' },
        h('p', { text: 'Für die Analyse braucht die App einmalig einen API-Schlüssel von Anthropic. Dein Eintrag ist gespeichert.' }),
        h('a', { class: 'btn btn-secondary btn-block', href: '#/einstellungen' }, 'Einrichten')));
    } else {
      container.append(h('div', { class: 'callout' },
        h('p', { text: 'Noch nicht analysiert.' }),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => analyzeEntry(entry.id) }, 'Analysieren')));
    }
    return;
  }

  const r = a.result;
  if (a.contentHash !== contentHash(entry)) {
    container.append(h('div', { class: 'callout' },
      h('p', { text: 'Du hast den Eintrag nach dieser Analyse geändert.' }),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => analyzeEntry(entry.id) }, 'Neu analysieren')));
  }

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

  const n = a.contextIds.filter((id) => store.get(id)).length;
  container.append(h('div', { class: 'an-foot' },
    checkDetails(a.check),
    basisDetails(n ? `Grundlage: dieser Eintrag und ${n} ${n === 1 ? 'früherer' : 'frühere'}` : 'Grundlage: nur dieser Eintrag', a.contextIds),
    h('div', { class: 'chips chips-below' },
      h('span', { text: `${fmtStamp(a.at)} · ${modelName(a.model)}` }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => analyzeEntry(entry.id) }, 'Neu analysieren'))));
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

  button.addEventListener('click', async () => {
    for (const f of fields) f.save.flush();
    await Promise.allSettled(pendingSaves);
    analyzeEntry(entry.id);
  });
  refresh();

  return h('section', { class: 'an-sec' },
    h('h3', { text: list.length === 1 ? 'Eine Sache würde helfen' : 'Ein paar Dinge würden helfen' }),
    fields.map((f) => h('div', { class: 'question' }, h('p', { class: 'q', text: f.q }), f.ta)),
    h('div', { class: 'actions' }, button));
}
