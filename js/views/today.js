// Heute: schnell etwas festhalten und die heutigen Einträge sehen.

import { h, replace } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtDateLong, dayDiff } from '../core/dates.js';
import { navigate } from '../core/router.js';
import { analyzeEntry } from '../ai/tasks.js';
import { copyEntryPrompt } from '../ai/abo.js';
import { createComposer } from '../ui/composer.js';
import { pageHead, entryRow, label, empty, toast, settingsButton, lockButton } from '../ui/components.js';

export function TodayView() {
  const composer = createComposer({
    onSubmit: async ({ entry, analyze }) => {
      // Über das Abo: Auftrag sofort kopieren – iOS erlaubt das nur direkt beim Antippen.
      if (analyze && store.aiMode === 'abo') entry.aboRequest = copyEntryPrompt(entry);
      const saved = await store.save(entry);
      if (analyze) {
        if (store.aiMode === 'api' && store.settings.apiKey) analyzeEntry(saved.id);
        navigate(`#/eintrag/${encodeURIComponent(saved.id)}`);
      } else {
        toast('Gespeichert');
      }
    },
  });

  const listWrap = h('div');
  const heading = label('');

  function drawList() {
    const now = new Date();
    const today = store.all().filter((e) => dayDiff(e.occurredAt, now) === 0);
    heading.textContent = today.length ? `Heute · ${today.length} ${today.length === 1 ? 'Eintrag' : 'Einträge'}` : 'Heute';
    replace(listWrap, today.length
      ? h('div', { class: 'list' }, today.map((e) => entryRow(e)))
      : empty('Noch nichts notiert. Schreib einfach auf, was passiert ist – ein Satz reicht.'));
  }
  drawList();

  const offs = [store.on('entries', drawList), store.on('jobs', drawList)];

  const el = h('div', { class: 'page' },
    pageHead('Heute', fmtDateLong(new Date()), [lockButton(), settingsButton()]),
    composer.el,
    heading,
    listWrap);

  return {
    el,
    afterMount({ focus }) { if (focus) composer.focus(); },
    unmount() { composer.flushDraft(); offs.forEach((off) => off()); },
    focus: () => composer.focus(),
  };
}
