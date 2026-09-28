// Ein Eintrag im Detail – mit Analyse, Rückfragen und Vorschlägen.

import { h, replace, icon } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtDateLong, fmtTime } from '../core/dates.js';
import { norm, uniqueCaseless } from '../core/text.js';
import { navigate, goBack } from '../core/router.js';
import { topbar, empty, confirmSheet, openSheet, toast } from '../ui/components.js';
import { renderAnalysis, analysisSignature } from '../ui/analysis.js';
import { createComposer } from '../ui/composer.js';

export function EntryView({ params }) {
  const id = params[0];
  const entry0 = store.get(id);
  if (!entry0) {
    return { el: h('div', { class: 'page' }, topbar({ fallback: '#/journal' }), empty('Dieser Eintrag existiert nicht mehr.')) };
  }

  const headWrap = h('div');
  const analysisWrap = h('section', { class: 'analysis', 'aria-live': 'polite' });
  let lastSig = '';

  function more() {
    openSheet((close) => [
      h('h2', { text: 'Eintrag' }),
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => { close(); navigate(`#/eintrag/${encodeURIComponent(id)}/bearbeiten`); } }, 'Bearbeiten'),
        h('button', {
          class: 'btn btn-danger btn-block',
          type: 'button',
          onClick: async () => {
            close();
            const ok = await confirmSheet({ title: 'Eintrag löschen?', text: 'Der Eintrag und seine Analyse werden endgültig von diesem Gerät gelöscht.', confirm: 'Löschen', danger: true });
            if (!ok) return;
            await store.remove(id);
            toast('Gelöscht');
            goBack('#/journal');
          },
        }, 'Löschen'),
        h('button', { class: 'btn btn-block btn-quiet', type: 'button', onClick: close }, 'Abbrechen')),
    ]);
  }

  function drawHead(e) {
    const people = store.mentions(e);
    const tags = [
      ...people.map((p) => h('a', { class: 'tag', href: `#/person/${encodeURIComponent(p)}`, text: p })),
      e.mood ? h('span', { class: 'tag', text: e.mood }) : null,
      ...uniqueCaseless([e.category, ...e.themes].filter(Boolean)).map((t) => h('a', { class: 'tag', href: `#/suche?q=${encodeURIComponent(t)}`, text: t })),
    ].filter(Boolean);

    const sugPeople = e.suggestions.people.filter((p) => !people.some((x) => norm(x) === norm(p)));
    const sugThemes = e.suggestions.themes.filter((t) => t !== e.category && !e.themes.includes(t));
    const suggestions = (sugPeople.length || sugThemes.length)
      ? h('div', { class: 'suggest-box' },
        h('span', { class: 'field-label', text: 'Erkannt – zum Übernehmen antippen' }),
        h('div', { class: 'tags' },
          sugPeople.map((p) => h('button', {
            class: 'tag suggest', type: 'button', 'aria-label': `${p} als Person übernehmen`,
            onClick: () => store.update(id, (x) => {
              x.people = uniqueCaseless([...x.people, p]);
              x.suggestions.people = x.suggestions.people.filter((q) => norm(q) !== norm(p));
            }),
          }, `+ ${p}`)),
          sugThemes.map((t) => h('button', {
            class: 'tag suggest', type: 'button', 'aria-label': `${t} als Thema übernehmen`,
            onClick: () => store.update(id, (x) => {
              x.themes = uniqueCaseless([...x.themes, t]);
              x.suggestions.themes = x.suggestions.themes.filter((q) => q !== t);
            }),
          }, `+ ${t}`)),
          h('button', {
            class: 'tag suggest', type: 'button', 'aria-label': 'Vorschläge verwerfen',
            onClick: () => store.update(id, (x) => { x.suggestions = { people: [], themes: [] }; }),
          }, icon('close', 14))))
      : null;

    // Antworten auf frühere Rückfragen (die aktuellen stehen bei der Analyse).
    const current = new Set(e.analysis?.result?.rueckfragen || []);
    const older = e.followUps.filter((f) => f.antwort.trim() && !current.has(f.frage));

    replace(headWrap,
      h('p', { class: 'entry-date', text: `${fmtDateLong(e.occurredAt)} · ${fmtTime(e.occurredAt)}` }),
      e.place ? h('p', { class: 'entry-place', text: e.place }) : null,
      h('div', { class: 'entry-text', text: e.text }),
      tags.length ? h('div', { class: 'tags entry-tags' }, tags) : null,
      suggestions,
      older.length
        ? h('div', { class: 'followups' },
          h('span', { class: 'field-label', text: 'Ergänzungen' }),
          older.map((f) => h('div', { class: 'followup' }, h('p', { class: 'q', text: f.frage }), h('p', { class: 'a', text: f.antwort }))))
        : null);
  }

  function draw(force = false) {
    const e = store.get(id);
    if (!e) return;
    drawHead(e);
    const sig = analysisSignature(e);
    if (force || sig !== lastSig) {
      lastSig = sig;
      renderAnalysis(analysisWrap, e);
    }
  }
  draw(true);

  const offs = [
    store.on(`entry:${id}`, (e) => { if (e) draw(); }),
    store.on(`job:analyse:${id}`, () => draw(true)),
    store.on('kv:settings', () => draw()),
  ];

  const el = h('div', { class: 'page' },
    topbar({
      fallback: '#/journal',
      actions: [h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mehr', onClick: more }, icon('more'))],
    }),
    headWrap,
    analysisWrap);

  return { el, unmount() { offs.forEach((off) => off()); } };
}

export function EntryEditView({ params }) {
  const id = params[0];
  const entry = store.get(id);
  if (!entry) return { el: h('div', { class: 'page' }, topbar({ fallback: '#/journal' }), empty('Dieser Eintrag existiert nicht mehr.')) };

  const composer = createComposer({
    entry,
    onSubmit: async ({ entry: next }) => {
      await store.save(next);
      toast('Gesichert');
      goBack(`#/eintrag/${encodeURIComponent(id)}`);
    },
    onCancel: () => goBack(`#/eintrag/${encodeURIComponent(id)}`),
  });

  return {
    el: h('div', { class: 'page' },
      topbar({ fallback: `#/eintrag/${encodeURIComponent(id)}` }),
      h('h1', { class: 'page-title', text: 'Bearbeiten' }),
      h('div', { class: 'spacer' }),
      composer.el),
  };
}
