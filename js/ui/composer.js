// Eingabe für neue Einträge und zum Bearbeiten.

import { h, icon, autoGrow, debounce, replace } from '../core/dom.js';
import { store, makeId } from '../core/store.js';
import { STIMMUNGEN, KATEGORIEN } from '../core/constants.js';
import { splitNames, uniqueCaseless, norm } from '../core/text.js';
import { toInputValue, fromInputValue, fmtTime, dayDiff, fmtShortDay } from '../core/dates.js';
import { toast } from './components.js';

/**
 * @param {object} opts
 * @param {object} [opts.entry]   vorhandener Eintrag → Bearbeiten
 * @param {Function} opts.onSubmit ({entry, analyze}) => void
 * @param {Function} [opts.onCancel]
 */
export function createComposer({ entry = null, onSubmit, onCancel }) {
  const editing = !!entry;
  const draft = editing ? null : store.kv('draft');
  const init = entry || draft || {};

  const data = {
    text: init.text || '',
    people: [...(init.people || [])],
    place: init.place || '',
    mood: init.mood || '',
    category: init.category || '',
    occurredAt: editing ? entry.occurredAt : (draft?.occurredAt || null), // null = „jetzt“ beim Speichern
  };

  const saveDraft = debounce(() => {
    if (editing || !store.unlocked) return;
    const empty = !data.text.trim() && !data.people.length && !data.place && !data.mood && !data.category && !data.occurredAt;
    store.setKV('draft', empty ? null : { ...data }).catch(() => {});
  }, 500);

  // ----- Textfeld -----
  const textarea = h('textarea', {
    id: 'composer-text',
    class: 'composer-text',
    placeholder: 'Was ist passiert?',
    'aria-label': 'Was ist passiert?',
    rows: 4,
    autocapitalize: 'sentences',
    autocomplete: 'off',
    spellcheck: 'true',
    value: data.text,
  });
  const fit = autoGrow(textarea);
  textarea.addEventListener('input', () => { data.text = textarea.value; updateButtons(); saveDraft(); });

  // ----- Details -----
  const summary = h('span', { class: 'summary' });
  const toggle = h('button', { class: 'details-toggle', type: 'button', 'aria-expanded': 'false' },
    h('span', { text: 'Details' }), summary, h('span', { class: 'grow' }), icon('chevronDown', 18));
  const panel = h('div', { class: 'details-panel', hidden: true });
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  const peopleInput = h('input', {
    class: 'input', id: 'f-people', type: 'text', autocomplete: 'off', autocapitalize: 'words',
    placeholder: 'z. B. Max, Leon', value: data.people.join(', '), enterkeyhint: 'next',
  });
  const peopleChips = h('div', { class: 'chips' });
  peopleInput.addEventListener('input', () => {
    data.people = uniqueCaseless(splitNames(peopleInput.value));
    drawPeopleChips();
    updateSummary();
    saveDraft();
  });

  const placeInput = h('input', {
    class: 'input', id: 'f-place', type: 'text', autocomplete: 'off', autocapitalize: 'sentences',
    placeholder: 'z. B. Pause, Unterricht, Training', value: data.place, enterkeyhint: 'done',
  });
  const placeChips = h('div', { class: 'chips' });
  placeInput.addEventListener('input', () => { data.place = placeInput.value.trim(); drawPlaceChips(); updateSummary(); saveDraft(); });

  const timeInput = h('input', {
    class: 'input', id: 'f-time', type: 'datetime-local',
    value: toInputValue(data.occurredAt || new Date()),
  });
  const nowBtn = h('button', { class: 'chip small', type: 'button', text: 'Jetzt' });
  const timeHint = h('span', { class: 'muted small' });
  timeInput.addEventListener('change', () => {
    const d = fromInputValue(timeInput.value);
    data.occurredAt = d ? d.toISOString() : null;
    updateTimeHint();
    updateSummary();
    saveDraft();
  });
  nowBtn.addEventListener('click', () => {
    data.occurredAt = null;
    timeInput.value = toInputValue(new Date());
    updateTimeHint();
    updateSummary();
    saveDraft();
  });

  const moodChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Stimmung' });
  const catChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Kategorie' });

  function singleChoice(container, list, key) {
    replace(container, list.map((v) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(data[key] === v),
      onClick: () => { data[key] = data[key] === v ? '' : v; singleChoice(container, list, key); updateSummary(); saveDraft(); },
    }, v)));
  }

  function drawPeopleChips() {
    const known = store.people().slice(0, 8).map((p) => p.name);
    const chosen = new Set(data.people.map((p) => norm(p)));
    replace(peopleChips, known.map((name) => h('button', {
      class: 'chip small', type: 'button', 'aria-pressed': String(chosen.has(norm(name))),
      onClick: () => {
        data.people = chosen.has(norm(name))
          ? data.people.filter((p) => norm(p) !== norm(name))
          : uniqueCaseless([...data.people, name]);
        peopleInput.value = data.people.join(', ');
        drawPeopleChips();
        updateSummary();
        saveDraft();
      },
    }, name)));
    peopleChips.hidden = !known.length;
  }

  function drawPlaceChips() {
    const places = store.places(5);
    replace(placeChips, places.map((p) => h('button', {
      class: 'chip small', type: 'button', 'aria-pressed': String(norm(p) === norm(data.place)),
      onClick: () => {
        data.place = norm(p) === norm(data.place) ? '' : p;
        placeInput.value = data.place;
        drawPlaceChips();
        updateSummary();
        saveDraft();
      },
    }, p)));
    placeChips.hidden = !places.length;
  }

  function updateTimeHint() {
    if (!data.occurredAt) { timeHint.textContent = editing ? '' : 'Standard: Zeitpunkt beim Speichern'; nowBtn.hidden = true; return; }
    const d = new Date(data.occurredAt);
    timeHint.textContent = `${fmtShortDay(d)}, ${fmtTime(d)}`;
    nowBtn.hidden = editing;
  }

  function updateSummary() {
    const parts = [];
    if (data.people.length) parts.push(data.people.join(', '));
    if (data.place) parts.push(data.place);
    if (data.occurredAt && !editing) {
      const d = new Date(data.occurredAt);
      parts.push(dayDiff(d, new Date()) === 0 ? fmtTime(d) : fmtShortDay(d));
    }
    if (data.mood) parts.push(data.mood);
    if (data.category) parts.push(data.category);
    summary.textContent = parts.length ? `· ${parts.join(' · ')}` : '· optional';
  }

  panel.append(
    h('div', { class: 'field' }, h('label', { for: 'f-people', text: 'Person(en)' }), peopleInput, peopleChips),
    h('div', { class: 'field' }, h('label', { for: 'f-place', text: 'Ort' }), placeInput, placeChips),
    h('div', { class: 'field' },
      h('label', { for: 'f-time', text: 'Datum und Uhrzeit' }),
      timeInput,
      h('div', { class: 'chips chips-below' }, timeHint, nowBtn)),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Stimmung' }), moodChips),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Kategorie' }), catChips),
  );
  // Abstand zwischen Eingabe und Chips
  for (const c of [peopleChips, placeChips]) c.classList.add('chips-below');

  // ----- Knöpfe -----
  const primary = h('button', { class: 'btn btn-primary grow', type: 'button' }, editing ? 'Sichern' : 'Analysieren');
  const secondary = h('button', { class: 'btn btn-secondary', type: 'button' }, editing ? 'Abbrechen' : 'Nur speichern');

  function updateButtons() {
    const has = !!data.text.trim();
    primary.disabled = !has;
    if (!editing) secondary.disabled = !has;
  }

  function buildEntry() {
    const now = new Date().toISOString();
    const base = editing ? structuredClone(entry) : { id: makeId(), createdAt: now, followUps: [], analysis: null, themes: [], suggestions: { people: [], themes: [] } };
    return {
      ...base,
      text: data.text.trim(),
      people: uniqueCaseless(data.people),
      place: data.place.trim(),
      mood: data.mood,
      category: data.category,
      occurredAt: data.occurredAt || (editing ? entry.occurredAt : now),
    };
  }

  function reset() {
    saveDraft.cancel();
    Object.assign(data, { text: '', people: [], place: '', mood: '', category: '', occurredAt: null });
    textarea.value = '';
    peopleInput.value = '';
    placeInput.value = '';
    timeInput.value = toInputValue(new Date());
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    singleChoice(moodChips, STIMMUNGEN, 'mood');
    singleChoice(catChips, KATEGORIEN, 'category');
    drawPeopleChips();
    drawPlaceChips();
    updateTimeHint();
    updateSummary();
    updateButtons();
    fit();
    store.setKV('draft', null).catch(() => {});
  }

  let busy = false;
  async function submit(analyze) {
    if (busy || !data.text.trim()) return;
    busy = true;
    try {
      await onSubmit({ entry: buildEntry(), analyze });
      if (!editing) reset();
    } catch (err) {
      console.error(err);
      toast(`Speichern hat nicht geklappt: ${err.message}`, 4000);
    } finally {
      busy = false;
    }
  }

  primary.addEventListener('click', () => submit(!editing));
  secondary.addEventListener('click', () => (editing ? onCancel?.() : submit(false)));

  // Startzustand
  singleChoice(moodChips, STIMMUNGEN, 'mood');
  singleChoice(catChips, KATEGORIEN, 'category');
  drawPeopleChips();
  drawPlaceChips();
  updateTimeHint();
  updateSummary();
  updateButtons();
  if (editing && (data.people.length || data.place || data.mood || data.category)) {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  if (editing) timeInput.value = toInputValue(entry.occurredAt);

  const el = h('section', { class: 'composer', 'aria-label': editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag' },
    textarea, toggle, panel,
    h('div', { class: 'actions' }, secondary, primary));

  return {
    el,
    focus() {
      textarea.focus({ preventScroll: true });
      const len = textarea.value.length;
      try { textarea.setSelectionRange(len, len); } catch { /* egal */ }
    },
    flushDraft() { saveDraft.flush(); },
    hasText: () => !!data.text.trim(),
  };
}
