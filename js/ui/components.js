// Gemeinsame Bausteine der Oberfläche.

import { h, icon, clear } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtTime, fmtShortDay } from '../core/dates.js';
import { highlight, snippetAround } from '../core/text.js';
import { goBack, navigate } from '../core/router.js';
import { isRunning, getJob } from '../ai/tasks.js';

export function pageHead(title, sub, actions = []) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', { class: 'page-title', text: title }),
      sub ? h('p', { class: 'page-sub', text: sub }) : null),
    actions.length ? h('div', { class: 'head-actions' }, actions) : null);
}

export function iconButton(name, label, onClick) {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onClick }, icon(name));
}

export function settingsButton() {
  return iconButton('settings', 'Einstellungen', () => navigate('#/einstellungen'));
}

export function lockButton() {
  return iconButton('lock', 'Jetzt sperren', () => document.dispatchEvent(new CustomEvent('nb:lock')));
}

export function topbar({ backLabel = 'Zurück', fallback = '#/heute', actions = [] } = {}) {
  return h('div', { class: 'topbar' },
    h('button', { class: 'back', type: 'button', onClick: () => goBack(fallback) }, icon('back', 24), backLabel),
    h('div', { class: 'topbar-actions' }, actions));
}

export function label(text) {
  return h('h2', { class: 'label', text });
}

export function empty(...children) {
  return h('div', { class: 'empty' }, children);
}

/** Eine Zeile in Listen. `terms` markiert Suchtreffer. */
export function entryRow(e, { showDay = false, terms = null } = {}) {
  const meta = [showDay ? `${fmtShortDay(e.occurredAt)}, ${fmtTime(e.occurredAt)}` : fmtTime(e.occurredAt)];
  if (e.place) meta.push(e.place);
  const people = store.mentions(e);
  if (people.length) meta.push(people.slice(0, 3).join(', ') + (people.length > 3 ? ' …' : ''));

  const foot = [];
  if (isRunning(`analyse:${e.id}`)) foot.push(h('span', { class: 'pending', text: 'wird analysiert …' }));
  else if (getJob(`analyse:${e.id}`)?.phase === 'error') foot.push('Analyse fehlgeschlagen');
  else if (e.mood) foot.push(e.mood);

  const text = terms ? snippetAround(e.text, terms) : e.text;
  return h('a', { class: 'row', href: `#/eintrag/${encodeURIComponent(e.id)}` },
    h('div', { class: 'row-meta' }, meta.map((m, i) => h('span', { text: i ? `· ${m}` : m }))),
    h('div', { class: 'row-text' }, terms ? highlight(text, terms) : text),
    foot.length ? h('div', { class: 'row-foot' }, foot) : null);
}

// ---------- Hinweis unten ----------

let toastTimer;
export function toast(message, ms = 1800) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Blatt von unten (Dialog) ----------

let openSheetClose = null;

/** Öffnet ein Blatt. `build(close)` liefert den Inhalt. Gibt eine Schließen-Funktion zurück. */
export function openSheet(build, { onClose } = {}) {
  openSheetClose?.();
  const root = document.getElementById('sheet-root');
  const previous = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    clear(root);
    openSheetClose = null;
    onClose?.();
    if (previous && document.contains(previous)) previous.focus?.({ preventScroll: true });
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, build(close));
  const backdrop = h('div', { class: 'backdrop', onClick: (ev) => { if (ev.target === backdrop) close(); } }, sheet);
  root.append(backdrop);
  document.addEventListener('keydown', onKey);
  openSheetClose = close;
  const first = sheet.querySelector('input, textarea');
  if (first) first.focus({ preventScroll: true });
  else sheet.querySelector('button')?.focus({ preventScroll: true });
  return close;
}

export function closeSheet() { openSheetClose?.(); }

/** Rückfrage mit Ja/Nein. */
export function confirmSheet({ title, text, confirm = 'OK', cancel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet((close) => [
      h('h2', { text: title }),
      text ? h('p', { text }) : null,
      h('div', { class: 'stack' },
        h('button', { class: `btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => { answered = true; close(); resolve(true); } }, confirm),
        h('button', { class: 'btn btn-block btn-secondary', type: 'button', onClick: () => close() }, cancel)),
    ], { onClose: () => { if (!answered) resolve(false); } });
  });
}

// ---------- Kleine Helfer ----------

export function progress(title, sub) {
  return h('div', { class: 'progress', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('div', {}, h('span', { text: title }), sub ? h('span', { class: 'small', text: sub }) : null));
}

export function segmented(options, value, onChange, ariaLabel) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel });
  const draw = (v) => {
    clear(wrap);
    for (const o of options) {
      wrap.append(h('button', {
        type: 'button',
        'aria-pressed': String(o.value === v),
        onClick: () => { draw(o.value); onChange(o.value); },
      }, o.label));
    }
  };
  draw(value);
  return wrap;
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
