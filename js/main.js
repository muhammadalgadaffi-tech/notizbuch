// Start der App: Sperre, Navigation, automatisches Sperren.

import { h, icon, clear } from './core/dom.js';
import { store } from './core/store.js';
import { setupRouter, startRouter, stopRouter, navigate, currentPath } from './core/router.js';
import { applyTheme, getAutoLockMinutes } from './core/prefs.js';
import { autoLockSuspended } from './core/session.js';
import { renderSetup, renderUnlock } from './views/lock.js';
import { TodayView } from './views/today.js';
import { JournalView } from './views/journal.js';
import { InsightsView } from './views/insights.js';
import { SearchView } from './views/search.js';
import { EntryView, EntryEditView } from './views/entry.js';
import { PersonView } from './views/person.js';
import { SettingsView } from './views/settings.js';
import { closeSheet } from './ui/components.js';

const appEl = document.getElementById('app');
const lockEl = document.getElementById('lock');

// ---------- Darstellung ----------
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

// ---------- Tab-Leiste ----------
const TABS = [
  { id: 'heute', label: 'Heute', icon: 'write', hash: '#/heute', focus: true },
  { id: 'journal', label: 'Journal', icon: 'book', hash: '#/journal' },
  { id: 'insights', label: 'Insights', icon: 'pattern', hash: '#/insights' },
  { id: 'suche', label: 'Suche', icon: 'search', hash: '#/suche', focus: true },
];

function focusField(tab) {
  const el = tab === 'heute' ? document.getElementById('composer-text') : document.querySelector('.search-field input');
  el?.focus({ preventScroll: tab === 'heute' });
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  clear(bar);
  for (const t of TABS) {
    const btn = h('button', { class: 'tab', type: 'button', dataset: { tab: t.id } }, icon(t.icon, 24), h('span', { text: t.label }));
    btn.addEventListener('click', () => {
      if (currentPath() === t.hash.slice(1)) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (t.focus) focusField(t.id);
      } else {
        // Sofort zeichnen und fokussieren – iOS öffnet die Tastatur nur direkt nach einem Antippen.
        navigate(t.hash, { focus: !!t.focus });
      }
    });
    bar.append(btn);
  }
}

function setTab(id) {
  for (const b of document.querySelectorAll('.tab')) {
    if (b.dataset.tab === id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

setupRouter([
  { pattern: /^\/heute$/, view: TodayView, tab: 'heute' },
  { pattern: /^\/journal$/, view: JournalView, tab: 'journal' },
  { pattern: /^\/insights$/, view: InsightsView, tab: 'insights' },
  { pattern: /^\/suche$/, view: SearchView, tab: 'suche' },
  { pattern: /^\/eintrag\/([^/]+)$/, view: EntryView, tab: null },
  { pattern: /^\/eintrag\/([^/]+)\/bearbeiten$/, view: EntryEditView, tab: null },
  { pattern: /^\/person\/([^/]+)$/, view: PersonView, tab: 'insights' },
  { pattern: /^\/einstellungen$/, view: SettingsView, tab: null },
], {
  tabChanged: (tab) => {
    if (tab) setTab(tab);
    // Ein entferntes Eingabefeld meldet kein „Fokus weg“ – daher nach jedem Seitenwechsel prüfen.
    requestAnimationFrame(() => { if (!isTextField(document.activeElement)) document.body.classList.remove('kb-open'); });
  },
});

// ---------- Tastatur: Tab-Leiste ausblenden, solange getippt wird (nur Touch-Geräte) ----------
const touch = window.matchMedia('(pointer: coarse)').matches;
function isTextField(el) {
  return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file', 'submit'].includes(el.type)));
}
if (touch) {
  document.addEventListener('focusin', (ev) => { if (isTextField(ev.target)) document.body.classList.add('kb-open'); });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isTextField(document.activeElement)) document.body.classList.remove('kb-open'); }, 60);
  });
}

// ---------- Öffnen und Sperren ----------
let tabbarBuilt = false;

async function enterApp() {
  appEl.hidden = false;
  if (!tabbarBuilt) { buildTabbar(); tabbarBuilt = true; }
  // Die Seite wird unter der Sperre gezeichnet und das Eingabefeld fokussiert,
  // solange das Code-Feld noch aktiv ist – so bleibt auf dem iPhone die Tastatur offen.
  startRouter({ focus: currentPath() === '/heute' });
  clear(lockEl);
}

function showUnlock() {
  renderUnlock(lockEl, { onUnlocked: enterApp });
}

function lockNow() {
  if (!store.unlocked) return;
  closeSheet();
  stopRouter();
  store.lock();
  appEl.hidden = true;
  document.body.classList.remove('kb-open');
  showUnlock();
}
document.addEventListener('nb:lock', lockNow);

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    if (getAutoLockMinutes() === 0 && !autoLockSuspended()) lockNow();
    return;
  }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (store.unlocked && !autoLockSuspended() && away >= getAutoLockMinutes() * 60000 && away > 0) lockNow();
});

// ---------- Offline-Fähigkeit ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker nicht registriert', err));
}

window.addEventListener('unhandledrejection', (ev) => console.error('Unerwarteter Fehler', ev.reason));

// ---------- Start ----------
async function boot() {
  try {
    if (await store.hasVault()) showUnlock();
    else renderSetup(lockEl, { onDone: enterApp });
  } catch (err) {
    clear(lockEl).append(h('div', { class: 'lock-inner' },
      h('h1', { class: 'lock-title', text: 'Notizbuch' }),
      h('p', { class: 'lock-text', text: `Der Speicher ist gerade nicht verfügbar (${err.message}). Schließe die App ganz und öffne sie erneut. In einem privaten Safari-Fenster funktioniert die App nicht.` })));
  }
}

boot();
