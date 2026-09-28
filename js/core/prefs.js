// Kleine, nicht vertrauliche Voreinstellungen (Darstellung, Sperrzeit).
// Sie liegen unverschlüsselt im Browser, weil sie schon vor dem Entsperren gebraucht werden.

const THEME_KEY = 'nb.theme';
const LOCK_KEY = 'nb.autolock';

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* privater Modus o. Ä. */ }
}

export function getTheme() {
  const v = read(THEME_KEY, 'system');
  return ['system', 'light', 'dark'].includes(v) ? v : 'system';
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Farbe der Statusleiste anpassen
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#0f0f10' : '#ffffff';
  document.head.append(meta);
}

export function setTheme(theme) {
  write(THEME_KEY, theme);
  applyTheme(theme);
}

export function getAutoLockMinutes() {
  const v = Number(read(LOCK_KEY, '5'));
  return Number.isFinite(v) && v >= 0 ? v : 5;
}

export function setAutoLockMinutes(min) {
  write(LOCK_KEY, String(min));
}

/** Alle lokalen Voreinstellungen entfernen (beim Löschen aller Daten). */
export function clearPrefs() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('nb.')) localStorage.removeItem(k);
  } catch { /* egal */ }
}
