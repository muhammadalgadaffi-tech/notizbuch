// Einfache Navigation über die Adresse (#/heute, #/eintrag/…).
// Seiten werden sofort gezeichnet – so kann „Heute“ beim Antippen direkt die Tastatur öffnen.

import { clear } from './dom.js';

let routes = [];
let current = null;
let started = false;
let onTabChange = () => {};
const scroll = new Map();

export function setupRouter(list, { tabChanged }) {
  routes = list;
  onTabChange = tabChanged;
}

function parse(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/heute';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

function match(path) {
  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (m) return { route: r, params: m.slice(1).map((p) => decodeURIComponent(p)) };
  }
  return null;
}

let active = false;

function render({ back = false, focus = false } = {}) {
  if (!started || !active) return;
  const container = document.getElementById('view');
  const { path, query } = parse(location.hash);
  const found = match(path);
  if (!found) { navigate('#/heute', { replace: true }); return; }

  if (current) {
    scroll.set(current.key, window.scrollY);
    try { current.unmount?.(); } catch (err) { console.error(err); }
  }
  clear(container);

  const key = location.hash || '#/heute';
  const view = found.route.view({ params: found.params, query });
  container.append(view.el);
  current = { key, unmount: view.unmount };
  onTabChange(found.route.tab);
  window.scrollTo(0, back ? scroll.get(key) || 0 : 0);
  view.afterMount?.({ focus, back });
}

export function navigate(hash, { replace = false, focus = false } = {}) {
  const depth = history.state?.depth || 0;
  if (replace) history.replaceState({ depth }, '', hash);
  else history.pushState({ depth: depth + 1 }, '', hash);
  render({ focus });
}

/** Zurück – oder zur angegebenen Seite, falls es kein „Zurück“ gibt. */
export function goBack(fallback = '#/heute') {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** Aktuelle Seite neu zeichnen (z. B. nach dem Entsperren). */
export function refresh(opts) { render(opts); }

/** Nur die Adresse aktualisieren, ohne neu zu zeichnen (z. B. Suchbegriff). */
export function setQuery(hash) {
  history.replaceState(history.state, '', hash);
  if (current) current.key = hash;
}

export function currentPath() { return parse(location.hash).path; }

export function startRouter({ focus = false } = {}) {
  if (!started) {
    started = true;
    window.addEventListener('popstate', () => render({ back: true }));
    document.addEventListener('click', (ev) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey) return;
      const a = ev.target.closest?.('a[href^="#/"]');
      if (!a) return;
      ev.preventDefault();
      navigate(a.getAttribute('href'));
    });
  }
  if (!location.hash) history.replaceState({ depth: 0 }, '', '#/heute');
  else if (!history.state) history.replaceState({ depth: 0 }, '', location.hash);
  active = true;
  render({ focus });
}

export function stopRouter() {
  active = false;
  if (current) {
    try { current.unmount?.(); } catch (err) { console.error(err); }
  }
  current = null;
  clear(document.getElementById('view'));
}
