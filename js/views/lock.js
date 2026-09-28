// Einrichten (erster Start) und Entsperren.

import { h, replace } from '../core/dom.js';
import { store } from '../core/store.js';
import { WrongCodeError } from '../core/crypto.js';
import { clearPrefs } from '../core/prefs.js';
import { confirmSheet, isIOS, isStandalone } from '../ui/components.js';

const ATTEMPTS_KEY = 'nb.attempts';

function readAttempts() {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; }
}
function writeAttempts(v) {
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(v)); } catch { /* egal */ }
}

function installHint() {
  if (!isIOS() || isStandalone()) return null;
  return h('div', { class: 'callout' },
    h('p', {}, h('strong', { text: 'Tipp fürs iPhone: ' }),
      'Füge die App zuerst zum Home-Bildschirm hinzu (unten auf „Teilen“ tippen → „Zum Home-Bildschirm“) und richte sie dort ein. Safari und die Home-Bildschirm-App haben getrennte Speicher – Einträge aus Safari erscheinen dort nicht.'));
}

/** Erster Start: Code festlegen. */
export function renderSetup(root, { onDone }) {
  const code = h('input', { class: 'input', type: 'password', id: 'setup-code', autocomplete: 'off', enterkeyhint: 'next' });
  const repeat = h('input', { class: 'input', type: 'password', id: 'setup-repeat', autocomplete: 'off', enterkeyhint: 'done' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Notizbuch anlegen');

  async function submit() {
    err.textContent = '';
    if (code.value.length < 4) { err.textContent = 'Bitte mindestens 4 Zeichen.'; code.focus(); return; }
    if (code.value !== repeat.value) { err.textContent = 'Die beiden Eingaben stimmen nicht überein.'; repeat.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Wird angelegt …';
    try {
      await store.create(code.value);
      try { await navigator.storage?.persist?.(); } catch { /* optional */ }
      await onDone();
    } catch (e) {
      err.textContent = `Das hat nicht geklappt: ${e.message}`;
      btn.disabled = false;
      btn.textContent = 'Notizbuch anlegen';
    }
  }
  btn.addEventListener('click', submit);
  code.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); repeat.focus(); } });
  repeat.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });

  replace(root, h('div', { class: 'lock-inner' },
    h('h1', { class: 'lock-title', text: 'Notizbuch' }),
    h('p', { class: 'lock-text', text: 'Deine Einträge bleiben auf diesem Gerät und werden verschlüsselt gespeichert. Leg einen Code fest, mit dem du das Notizbuch öffnest.' }),
    installHint(),
    h('div', { class: 'field' }, h('label', { for: 'setup-code', text: 'Code' }), code),
    h('div', { class: 'field' }, h('label', { for: 'setup-repeat', text: 'Code wiederholen' }), repeat),
    h('p', { class: 'help', text: 'Mindestens 4 Zeichen – je länger, desto sicherer (zum Beispiel 6 Ziffern oder ein Wort). Wenn du den Code vergisst, lassen sich die Einträge nicht wiederherstellen.' }),
    err,
    btn));
}

/** Entsperren. `onUnlocked` wird aufgerufen, während das Code-Feld noch den Fokus hat (für die Tastatur auf dem iPhone). */
export function renderUnlock(root, { onUnlocked }) {
  const code = h('input', { class: 'input', type: 'password', id: 'unlock-code', autocomplete: 'off', enterkeyhint: 'go', 'aria-label': 'Code' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Öffnen');
  let busy = false;

  function waitMessage() {
    const a = readAttempts();
    const rest = Math.ceil((a.until - Date.now()) / 1000);
    return rest > 0 ? `Zu viele falsche Versuche. Warte ${rest} Sekunden.` : '';
  }

  async function submit() {
    if (busy) return;
    const wait = waitMessage();
    if (wait) { err.textContent = wait; return; }
    if (!code.value) { code.focus(); return; }
    busy = true;
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Wird geöffnet …';
    try {
      await store.unlock(code.value);
      writeAttempts({ n: 0, until: 0 });
      code.value = '';
      await onUnlocked();
    } catch (e) {
      if (e instanceof WrongCodeError) {
        const a = readAttempts();
        a.n += 1;
        if (a.n >= 5) a.until = Date.now() + Math.min(300, 30 * 2 ** (a.n - 5)) * 1000;
        writeAttempts(a);
        err.textContent = waitMessage() || 'Falscher Code.';
        code.select();
      } else {
        err.textContent = `Das hat nicht geklappt: ${e.message}`;
      }
      btn.disabled = false;
      btn.textContent = 'Öffnen';
    } finally {
      busy = false;
    }
  }

  btn.addEventListener('click', submit);
  code.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });

  const forgot = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Code vergessen?');
  forgot.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Code vergessen',
      text: 'Ohne den Code lassen sich die Einträge nicht entschlüsseln – das ist der Sinn der Verschlüsselung. Du kannst nur alles löschen und neu anfangen. Falls du ein Backup hast, kannst du es danach mit dem damaligen Code importieren.',
      confirm: 'Alles löschen und neu anfangen',
      danger: true,
    });
    if (!ok) return;
    await store.wipe();
    clearPrefs();
    location.replace(location.pathname);
  });

  replace(root, h('div', { class: 'lock-inner' },
    h('h1', { class: 'lock-title', text: 'Notizbuch' }),
    h('p', { class: 'lock-text', text: 'Gesperrt. Gib deinen Code ein.' }),
    h('div', { class: 'field' }, code),
    err,
    btn,
    h('div', { class: 'lock-links' }, forgot)));

  const msg = waitMessage();
  if (msg) err.textContent = msg;
  // Auf dem Computer direkt tippen können; auf dem iPhone öffnet sich die Tastatur erst beim Antippen.
  setTimeout(() => code.focus({ preventScroll: true }), 50);
}
