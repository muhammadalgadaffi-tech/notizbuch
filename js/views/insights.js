// Insights: was sich aus den eigenen Einträgen ergibt – Zählungen auf dem Gerät, Muster auf Wunsch.

import { h, replace, icon } from '../core/dom.js';
import { store } from '../core/store.js';
import { dayDiff, fmtAgoDays, dayKey } from '../core/dates.js';
import { pageHead, label, empty, segmented, settingsButton } from '../ui/components.js';
import { patternsCard } from '../ui/patterns.js';

const RANGE_KEY = 'nb.insightsRange';

function readRange() {
  try { const v = Number(localStorage.getItem(RANGE_KEY)); return [7, 14, 30].includes(v) ? v : 14; } catch { return 14; }
}

export function InsightsView() {
  const top = h('div');
  const pattern = h('div');
  let card = null;
  let days = readRange();

  function drawTop() {
    const all = store.all();
    if (!all.length) {
      replace(top, empty('Sobald du ein paar Tage geschrieben hast, erscheinen hier wiederkehrende Personen, Themen und mögliche Muster – ausschließlich aus deinen eigenen Einträgen.'));
      pattern.hidden = true;
      return;
    }
    pattern.hidden = false;
    const now = new Date();
    const week = all.filter((e) => dayDiff(e.occurredAt, now) < 7);
    const weekDays = new Set(week.map((e) => dayKey(e.occurredAt))).size;
    const recent = all.filter((e) => dayDiff(e.occurredAt, now) < 14);
    const moods = new Map();
    for (const e of recent) if (e.mood) moods.set(e.mood, (moods.get(e.mood) || 0) + 1);
    const moodList = [...moods].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxMood = Math.max(1, ...moodList.map((m) => m[1]));

    const people = store.people();
    const pending = store.pendingPeople();
    const themes = store.themes();

    const bars = moodList.length
      ? h('div', { class: 'bars', 'aria-label': 'Stimmungen der letzten 14 Tage' }, moodList.map(([mood, n]) => {
        const fill = h('div', { class: 'bar-fill' });
        fill.style.width = `${Math.round((n / maxMood) * 100)}%`;
        return [h('span', { text: mood }), h('div', { class: 'bar-track' }, fill), h('span', { class: 'n', text: String(n) })];
      }))
      : null;

    replace(top,
      label('Überblick'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'num', text: String(week.length) }), h('div', { class: 'lbl', text: `Einträge in 7 Tagen${weekDays ? ` · an ${weekDays} ${weekDays === 1 ? 'Tag' : 'Tagen'}` : ''}` })),
        h('div', { class: 'stat' }, h('div', { class: 'num', text: String(all.length) }), h('div', { class: 'lbl', text: 'insgesamt' }))),
      moodList.length ? h('p', { class: 'small muted', text: 'Stimmungen der letzten 14 Tage (sofern angegeben)' }) : null,
      bars,

      label('Personen'),
      people.length
        ? h('div', {}, people.slice(0, 12).map((p) => h('a', { class: 'nav-row', href: `#/person/${encodeURIComponent(p.name)}` },
          h('span', { class: 'name' }, p.name, h('span', { class: 'sub', text: `zuletzt ${fmtAgoDays(p.last)}` })),
          h('span', { class: 'val' }, `${p.count} ${p.count === 1 ? 'Eintrag' : 'Einträge'}`, icon('chevronRight', 16)))))
        : h('p', { class: 'muted small', text: 'Noch keine Personen. Trag Namen im Feld „Person(en)“ ein oder übernimm sie aus den Vorschlägen einer Analyse.' }),
      pending.length
        ? h('div', {},
          h('p', { class: 'small muted', text: 'Von Analysen erkannt, noch nicht bestätigt:' }),
          h('div', { class: 'tags' }, pending.slice(0, 10).map((p) => h('button', {
            class: 'tag suggest', type: 'button', 'aria-label': `${p.name} übernehmen`,
            onClick: () => store.confirmPerson(p.name),
          }, `+ ${p.name} (${p.ids.length})`))))
        : null,

      label('Themen'),
      themes.length
        ? h('div', {}, themes.map((t) => h('a', { class: 'nav-row', href: `#/suche?q=${encodeURIComponent(t.name)}` },
          h('span', { class: 'name', text: t.name }),
          h('span', { class: 'val' },
            t.confirmed ? `${t.confirmed}` : '',
            t.suggested ? h('span', { class: 'muted small', text: `${t.confirmed ? '· ' : ''}+${t.suggested} vermutet` }) : null,
            icon('chevronRight', 16)))))
        : h('p', { class: 'muted small', text: 'Noch keine Themen. Wähle beim Schreiben eine Kategorie oder übernimm Vorschläge aus einer Analyse.' }),
      h('p', { class: 'help', text: '„Vermutet“ heißt: von einer Analyse vorgeschlagen, aber von dir noch nicht bestätigt.' }));
  }

  function drawPattern() {
    card?.unmount();
    card = patternsCard({ days });
    replace(pattern,
      label('Muster'),
      segmented([{ value: 7, label: '7 Tage' }, { value: 14, label: '14 Tage' }, { value: 30, label: '30 Tage' }], days, (v) => {
        days = v;
        try { localStorage.setItem(RANGE_KEY, String(v)); } catch { /* egal */ }
        card?.unmount();
        card = patternsCard({ days });
        pattern.lastChild.replaceWith(card.el);
      }, 'Zeitraum'),
      card.el);
  }

  drawTop();
  drawPattern();
  const offs = [store.on('entries', drawTop)];

  return {
    el: h('div', { class: 'page' },
      pageHead('Insights', 'Nur aus deinen eigenen Einträgen', [settingsButton()]),
      top,
      pattern),
    unmount() { offs.forEach((off) => off()); card?.unmount(); },
  };
}
