// Eine Person: alle Einträge, in denen sie vorkommt, und mögliche Muster.

import { h, replace } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtDateNumeric, fmtAgoDays } from '../core/dates.js';
import { topbar, label, empty, entryRow } from '../ui/components.js';
import { patternsCard } from '../ui/patterns.js';

export function PersonView({ params }) {
  const name = store.displayName(params[0]);
  const head = h('div');
  const list = h('div');
  const card = patternsCard({ person: name }, { minEntries: 2 });

  function draw() {
    const entries = store.entriesWithPerson(name);
    const first = entries[entries.length - 1];
    const last = entries[0];
    replace(head,
      h('header', { class: 'page-head' }, h('div', { class: 'grow' },
        h('h1', { class: 'page-title', text: name }),
        h('p', {
          class: 'page-sub',
          text: entries.length
            ? `${entries.length} ${entries.length === 1 ? 'Eintrag' : 'Einträge'} · zuerst am ${fmtDateNumeric(first.occurredAt)} · zuletzt ${fmtAgoDays(last.occurredAt)}`
            : 'Keine Einträge',
        }))));
    replace(list, entries.length
      ? h('div', { class: 'list' }, entries.map((e) => entryRow(e, { showDay: true })))
      : empty('Keine Einträge mit dieser Person.'));
  }
  draw();
  const offs = [store.on('entries', draw)];

  return {
    el: h('div', { class: 'page' },
      topbar({ fallback: '#/insights' }),
      head,
      label('Verlauf'),
      card.el,
      label('Einträge'),
      list),
    unmount() { offs.forEach((off) => off()); card.unmount(); },
  };
}
