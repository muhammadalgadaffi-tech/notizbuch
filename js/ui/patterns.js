// Muster über mehrere Einträge – für Insights und die Personenseite.

import { h, replace } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtShortDay, fmtTime, fmtStamp } from '../core/dates.js';
import { findPatterns, getJob, isRunning, patternKey, patternSignature } from '../ai/tasks.js';
import { entriesForPatterns } from '../ai/context.js';
import { progress } from './components.js';
import { section, checkDetails, errorCallout, modelName } from './analysis.js';

function refsDetails(ids) {
  const entries = ids.map((id) => store.get(id)).filter(Boolean);
  if (!entries.length) return null;
  return h('details', { class: 'refs' },
    h('summary', { text: `${entries.length} ${entries.length === 1 ? 'Eintrag' : 'Einträge'} ansehen` }),
    h('ul', { class: 'steps' }, entries.map((e) => h('li', {},
      h('a', { href: `#/eintrag/${encodeURIComponent(e.id)}` },
        h('span', { class: 'when', text: `${fmtShortDay(e.occurredAt)}, ${fmtTime(e.occurredAt)}` }),
        h('span', { class: 'what', text: e.text.length > 90 ? `${e.text.slice(0, 90)}…` : e.text }))))));
}

function renderResult(record) {
  const r = record.result;
  const nothing = !r.aufgefallen.length && !r.muster.length && !r.nachdenken.length;
  return [
    nothing ? h('p', { class: 'muted', text: 'In diesen Einträgen ist nichts Wiederkehrendes aufgefallen.' }) : null,
    section('Was dir aufgefallen ist', r.aufgefallen.length
      ? h('div', {}, r.aufgefallen.map((a) => h('div', { class: 'pattern' }, h('p', { text: a.text }), refsDetails(a.eintraege))))
      : null),
    section(r.muster.length === 1 ? 'Mögliches Muster' : 'Mögliche Muster', r.muster.length
      ? h('div', {}, r.muster.map((m) => h('div', { class: 'pattern' },
        m.titel ? h('h4', { text: m.titel }) : null,
        h('ol', { class: 'steps' }, m.schritte.map((st) => {
          const e = store.get(st.eintrag_id);
          return h('li', {}, h('a', { href: `#/eintrag/${encodeURIComponent(st.eintrag_id)}` },
            h('span', { class: 'when', text: e ? `${fmtShortDay(e.occurredAt)}, ${fmtTime(e.occurredAt)}` : '' }),
            h('span', { class: 'what', text: st.kurz || (e ? e.text.slice(0, 60) : '') })));
        })),
        m.deutung ? h('p', { text: m.deutung }) : null,
        h('p', { class: 'certainty', text: `Sicherheit: ${m.sicherheit}` }))))
      : null),
    section('Zum Nachdenken', r.nachdenken.length
      ? h('div', {}, r.nachdenken.map((n) => h('div', { class: 'pattern' }, h('p', { text: n.frage }), refsDetails(n.bezug))))
      : null),
    section('Was offen bleibt', r.offen),
  ];
}

/**
 * Karte mit Musterauswertung.
 * @param {{days?: number, person?: string}} opts
 */
export function patternsCard(opts, { minEntries = 3 } = {}) {
  const el = h('div', { class: 'card' });
  const jobKey = `muster:${patternKey(opts)}`;

  function draw() {
    const job = getJob(jobKey);
    const record = store.kv('insights')[patternKey(opts)];
    const count = entriesForPatterns(opts).length;

    if (isRunning(jobKey)) {
      replace(el, job.phase === 'review'
        ? progress('Prüfe die Muster …', 'Jede Beobachtung wird an deinen Einträgen gegengeprüft.')
        : progress('Suche nach Wiederholungen …', `${count} Einträge werden ausgewertet. Das dauert meist 20 bis 60 Sekunden.`));
      return;
    }

    const parts = [];
    if (job?.phase === 'error') parts.push(errorCallout(job.error, () => findPatterns(opts)));

    if (record) {
      const stale = record.signature !== patternSignature(opts);
      parts.push(...renderResult(record));
      parts.push(h('div', { class: 'an-foot' },
        checkDetails(record.check),
        h('div', { class: 'chips chips-below' },
          h('span', { text: `${fmtStamp(record.at)} · ${record.count} Einträge · ${modelName(record.model)}` }),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => findPatterns(opts) }, stale ? 'Aktualisieren' : 'Neu auswerten')),
        stale ? h('p', { class: 'small muted', text: 'Seit dieser Auswertung gibt es neue oder geänderte Einträge.' }) : null));
    } else if (count < minEntries) {
      parts.push(h('p', { class: 'muted', text: `Für Muster braucht es mindestens ${minEntries} Einträge${opts.person ? ` mit ${opts.person}` : ' in diesem Zeitraum'}. Bisher: ${count}.` }));
    } else if (!store.settings.apiKey) {
      parts.push(h('p', { class: 'muted', text: 'Für die Auswertung braucht die App einen API-Schlüssel.' }),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-secondary grow', href: '#/einstellungen' }, 'Einrichten')));
    } else if (job?.phase !== 'error') {
      parts.push(
        h('p', { class: 'muted', text: opts.person
          ? `Die ${count} Einträge mit ${opts.person} werden nach Wiederholungen durchsucht und anschließend gegengeprüft.`
          : `Die ${count} Einträge aus diesem Zeitraum werden nach Wiederholungen durchsucht und anschließend gegengeprüft.` }),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary grow', type: 'button', onClick: () => findPatterns(opts) }, 'Muster suchen')));
    }
    replace(el, parts);
  }

  draw();
  const offs = [
    store.on(`job:${jobKey}`, draw),
    store.on('kv:insights', draw),
    store.on('entries', draw),
    store.on('kv:settings', draw),
  ];
  return { el, unmount: () => offs.forEach((off) => off()) };
}
