// Suche: Stichwortsuche auf dem Gerät – und auf Wunsch eine Frage an das eigene Journal.

import { h, replace, icon, debounce } from '../core/dom.js';
import { store } from '../core/store.js';
import { norm, searchTerms } from '../core/text.js';
import { fmtStamp, fmtDateNumeric } from '../core/dates.js';
import { setQuery } from '../core/router.js';
import { askJournal, getJob, isRunning, dismissJob } from '../ai/tasks.js';
import { entryRow, label, empty, progress } from '../ui/components.js';
import { section, checkDetails, basisDetails, errorCallout, entryCard, modelName } from '../ui/analysis.js';
import { aboBox, renderAboAnswer } from '../ui/abo.js';
import { copyQuestionPrompt, pendingQuestion, saveQuestionAnswer, cancelPending } from '../ai/abo.js';

const EXAMPLES = [
  'Was ist mir in den letzten zwei Wochen über meine Motivation aufgefallen?',
  'Worüber habe ich diese Woche am meisten geschrieben?',
  'Wie ging es mir in letzter Zeit nach dem Training?',
];

function textSearch(q) {
  const terms = searchTerms(q);
  if (!terms.length) return { terms, hits: [] };
  const hits = store.all().filter((e) => {
    const hay = norm([e.text, e.place, e.mood, e.category, ...e.themes, ...store.mentions(e), ...e.followUps.map((f) => f.antwort)].join('\n'));
    return terms.every((t) => hay.includes(t));
  });
  return { terms, hits };
}

function answerCard(record, onClose) {
  const r = record.result || {};
  const belege = (r.belege || []).map((b) => ({ b, e: store.get(b.eintrag_id) })).filter((x) => x.e);
  const b = record.basis || {};
  const basisTitle = b.count
    ? `Grundlage: ${b.count} ${b.count === 1 ? 'Eintrag' : 'Einträge'}${b.from ? ` (${fmtDateNumeric(b.from, false)} – ${fmtDateNumeric(b.to, false)})` : ''}`
    : 'Grundlage: keine Einträge';
  const body = record.mode === 'abo'
    ? renderAboAnswer(record.text, record.refs).nodes
    : [
      section('Antwort', r.antwort),
      belege.length ? section('Worauf sich das stützt', h('div', {}, belege.map(({ b: x, e }) => entryCard(e, x.bezug)))) : null,
      section('Mögliches Muster', r.muster),
      section('Was offen bleibt', r.offen),
      section('Zum Nachdenken', r.denkfrage),
    ];
  return h('article', { class: 'answer-card', 'aria-live': 'polite' },
    h('div', { class: 'answer-head' },
      h('h2', { class: 'q-title', text: record.frage }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Antwort schließen', onClick: onClose }, icon('close', 20))),
    body,
    record.empty ? null : h('div', { class: 'an-foot' },
      checkDetails(record.check),
      basisDetails(basisTitle, record.ids || []),
      h('p', { text: `${fmtStamp(record.at)} · ${modelName(record.model)}` })));
}

export function SearchView({ query }) {
  let q = query.get('q') || '';
  let shown = null;
  let box = null;
  let asked = (store.aiMode === 'abo' ? pendingQuestion()?.frage : getJob('frage')?.record?.frage) || '';

  const input = h('input', {
    type: 'search',
    placeholder: 'Suchen oder Frage stellen',
    'aria-label': 'Suchen oder Frage stellen',
    enterkeyhint: 'search',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    value: q,
  });
  const clearBtn = h('button', { class: 'clear-btn', type: 'button', 'aria-label': 'Eingabe löschen' }, icon('close', 18));
  const askWrap = h('div');
  const answerWrap = h('div');
  const results = h('div');

  const syncUrl = debounce(() => setQuery(q ? `#/suche?q=${encodeURIComponent(q)}` : '#/suche'), 300);

  function ask(question) {
    const text = question.trim();
    if (!text) return;
    shown = null;
    asked = text;
    input.blur();
    if (store.aiMode === 'abo') {
      // Sofort kopieren – iOS erlaubt das nur direkt beim Antippen.
      const res = copyQuestionPrompt(text);
      if (res.empty) {
        shown = {
          frage: text, empty: true, at: new Date().toISOString(),
          result: { antwort: res.basis.range ? `Für den Zeitraum „${res.basis.range}“ gibt es keine Einträge.` : 'Es gibt noch keine Einträge, auf die sich eine Antwort stützen könnte.' },
        };
      }
      dismissJob('frage');
    } else {
      askJournal(text);
    }
    drawAsk();
    drawAnswer();
    answerWrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function drawAsk() {
    clearBtn.hidden = !q;
    replace(askWrap, q.trim().length >= 3 && q.trim() !== asked
      ? h('button', { class: 'ask-row', type: 'button', onClick: () => ask(q) },
        h('span', { class: 't' }, 'Journal fragen: ', h('strong', { text: `„${q.trim()}“` })),
        icon('arrow', 20))
      : null);
  }

  function drawAnswer() {
    const job = getJob('frage');
    const close = () => { shown = null; asked = ''; dismissJob('frage'); drawAnswer(); drawAsk(); };

    const pending = store.aiMode === 'abo' && !shown ? pendingQuestion() : null;
    if (pending) {
      // Nicht neu zeichnen, solange gerade eine Antwort eingefügt wird.
      if (box?.isConnected && box.querySelector('.abo-answer')?.value.trim()) return;
      box = aboBox({
        copyKey: 'frage',
        what: `deine Frage und ${pending.basis.count} ${pending.basis.count === 1 ? 'Eintrag' : 'Einträge'}`,
        onCopy: () => { copyQuestionPrompt(pending.frage); },
        onSave: async (text) => {
          const rec = await saveQuestionAnswer(text);
          shown = rec;
          asked = rec.frage;
          box = null;
          drawAnswer();
          drawResults();
        },
        onCancel: async () => {
          box = null;
          asked = '';
          await cancelPending('frage');
          drawAnswer();
          drawAsk();
        },
      });
      replace(answerWrap, h('article', { class: 'answer-card' },
        h('div', { class: 'answer-head' }, h('h2', { class: 'q-title', text: pending.frage })),
        box));
      return;
    }
    box = null;

    if (isRunning('frage')) {
      replace(answerWrap, job.phase === 'review'
        ? progress('Prüfe die Antwort …', 'Jede Aussage wird an deinen Einträgen gegengeprüft.')
        : progress('Lese die passenden Einträge …', 'Das dauert meist 20 bis 60 Sekunden.'));
      return;
    }
    if (job?.phase === 'error' && !shown) {
      replace(answerWrap, errorCallout(job.error, () => ask(job.question)));
      return;
    }
    const record = shown || (job?.phase === 'done' ? job.record : null);
    replace(answerWrap, record ? answerCard(record, close) : null);
  }

  function drawResults() {
    if (!q.trim()) {
      const people = store.people().slice(0, 8);
      const themes = store.themes().slice(0, 8);
      const past = store.kv('questions').slice(0, 8);
      const setQ = (v) => { q = v; input.value = v; drawAsk(); drawResults(); syncUrl(); };
      replace(results,
        people.length ? [label('Personen'), h('div', { class: 'chips' }, people.map((p) => h('button', { class: 'chip', type: 'button', onClick: () => setQ(p.name) }, p.name)))] : null,
        themes.length ? [label('Themen'), h('div', { class: 'chips' }, themes.map((t) => h('button', { class: 'chip', type: 'button', onClick: () => setQ(t.name) }, t.name)))] : null,
        label('Zum Beispiel fragen'),
        h('div', {}, EXAMPLES.map((ex) => h('button', { class: 'example', type: 'button', onClick: () => { setQ(ex); ask(ex); } }, ex))),
        past.length ? [label('Zuletzt gefragt'), h('div', {}, past.map((rec) => h('button', {
          class: 'nav-row', type: 'button',
          onClick: () => { shown = rec; asked = rec.frage; dismissJob('frage'); drawAnswer(); answerWrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
        }, h('span', { class: 'name', text: rec.frage }), h('span', { class: 'val', text: fmtStamp(rec.at) }))))] : null,
        !store.count() ? empty('Noch keine Einträge zum Durchsuchen.') : null);
      return;
    }
    const { terms, hits } = textSearch(q);
    replace(results,
      label(hits.length ? `${hits.length} ${hits.length === 1 ? 'Eintrag' : 'Einträge'}` : 'Keine Treffer'),
      hits.length
        ? h('div', { class: 'list' }, hits.slice(0, 200).map((e) => entryRow(e, { showDay: true, terms })))
        : empty('Kein Eintrag enthält diese Wörter. Du kannst die Frage aber oben an dein Journal stellen.'));
  }

  input.addEventListener('input', () => { q = input.value; drawAsk(); drawResults(); syncUrl(); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } });
  clearBtn.addEventListener('click', () => { q = ''; input.value = ''; drawAsk(); drawResults(); syncUrl(); input.focus(); });

  drawAsk();
  drawAnswer();
  drawResults();

  const offs = [
    store.on('job:frage', drawAnswer),
    store.on('kv:aboPending', drawAnswer),
    store.on('entries', drawResults),
  ];

  return {
    el: h('div', { class: 'page' },
      h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', { class: 'page-title', text: 'Suche' }))),
      h('div', { class: 'search-bar' },
        h('div', { class: 'search-field' }, icon('search', 18), input, clearBtn)),
      askWrap,
      answerWrap,
      results),
    afterMount({ focus }) { if (focus) input.focus({ preventScroll: true }); },
    unmount() { syncUrl.cancel(); offs.forEach((off) => off()); },
  };
}
