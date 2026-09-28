// Journal: alle Einträge, nach Tagen gruppiert.

import { h, replace } from '../core/dom.js';
import { store } from '../core/store.js';
import { dayKey, fmtDayTitle } from '../core/dates.js';
import { pageHead, entryRow, empty, settingsButton } from '../ui/components.js';

const PAGE = 120;

export function JournalView() {
  let limit = PAGE;
  const head = h('div');
  const body = h('div');

  function draw() {
    const all = store.all();
    replace(head, pageHead('Journal', all.length ? `${all.length} ${all.length === 1 ? 'Eintrag' : 'Einträge'}` : '', [settingsButton()]));
    if (!all.length) {
      replace(body, empty('Hier erscheinen alle deine Einträge. ', h('a', { href: '#/heute', text: 'Ersten Eintrag schreiben' })));
      return;
    }
    const shown = all.slice(0, limit);
    const groups = [];
    for (const e of shown) {
      const k = dayKey(e.occurredAt);
      if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, date: e.occurredAt, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    replace(body,
      groups.map((g) => h('section', {},
        h('h2', { class: 'day-head' }, fmtDayTitle(g.date), h('span', { class: 'muted', text: ` · ${g.items.length}` })),
        g.items.map((e) => entryRow(e)))),
      all.length > limit
        ? h('button', { class: 'btn btn-secondary btn-block more-btn', type: 'button', onClick: () => { limit += PAGE; draw(); } }, 'Ältere Einträge anzeigen')
        : null);
  }
  draw();
  const offs = [store.on('entries', draw), store.on('jobs', draw)];

  return {
    el: h('div', { class: 'page' }, head, body),
    unmount() { offs.forEach((off) => off()); },
  };
}
