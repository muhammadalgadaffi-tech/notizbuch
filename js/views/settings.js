// Einstellungen: API-Schlüssel, Modell, Sperre, Darstellung, Daten, Datenschutz.

import { h, replace, icon } from '../core/dom.js';
import { store } from '../core/store.js';
import { WrongCodeError } from '../core/crypto.js';
import { monthKey } from '../core/dates.js';
import { AUTO_LOCK_OPTIONS } from '../core/constants.js';
import { getTheme, setTheme, getAutoLockMinutes, setAutoLockMinutes, clearPrefs } from '../core/prefs.js';
import { suspendAutoLock, resumeAutoLock } from '../core/session.js';
import { buildEncryptedBackup, buildPlainExport, deliverFile, readImportFile, decryptBackup } from '../core/backup.js';
import { MODELS, testKey } from '../ai/api.js';
import { topbar, label, openSheet, confirmSheet, toast, segmented } from '../ui/components.js';

const fmtMoney = (n) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

export function SettingsView() {
  const keyGroup = h('div');
  const modelGroup = h('div');
  const usageWrap = h('div');

  // ---------- API-Schlüssel ----------
  function drawKey(status = null) {
    const key = store.settings.apiKey;
    const input = h('input', {
      class: 'input', type: 'password', id: 'api-key', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: key ? 'Neuen Schlüssel einfügen' : 'sk-ant-…', 'aria-label': 'API-Schlüssel',
    });
    const statusEl = h('p', { class: 'help', role: 'status' });
    if (status) { statusEl.textContent = status.text; if (status.error) statusEl.classList.add('error-text'); }

    const saveBtn = h('button', { class: 'btn btn-primary grow', type: 'button' }, 'Speichern und prüfen');
    saveBtn.addEventListener('click', async () => {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      saveBtn.disabled = true;
      statusEl.classList.remove('error-text');
      statusEl.textContent = 'Wird geprüft …';
      await store.setSettings({ apiKey: value });
      try {
        await testKey(value);
        drawKey({ text: 'Gespeichert. Der Schlüssel funktioniert.' });
      } catch (err) {
        drawKey({ text: `Gespeichert, aber: ${err.message}`, error: true });
      }
    });

    const testBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Prüfen');
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      statusEl.classList.remove('error-text');
      statusEl.textContent = 'Wird geprüft …';
      try { await testKey(store.settings.apiKey); drawKey({ text: 'Der Schlüssel funktioniert.' }); } catch (err) { drawKey({ text: err.message, error: true }); }
    });

    const removeBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Entfernen');
    removeBtn.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Schlüssel entfernen?', text: 'Danach sind Analysen erst wieder möglich, wenn du einen Schlüssel einträgst. Deine Einträge bleiben erhalten.', confirm: 'Entfernen', danger: true });
      if (!ok) return;
      await store.setSettings({ apiKey: '' });
      drawKey({ text: 'Schlüssel entfernt.' });
    });

    replace(keyGroup, h('div', { class: 'group' },
      h('div', { class: 'cell' }, h('span', { text: 'API-Schlüssel' }), h('span', { class: 'val', text: key ? `hinterlegt · …${key.slice(-4)}` : 'fehlt' })),
      h('div', { class: 'cell-block' },
        input,
        h('div', { class: 'actions' }, saveBtn, key ? testBtn : null),
        key ? h('div', { class: 'actions' }, removeBtn) : null,
        statusEl)),
    h('p', { class: 'help' },
      'Den Schlüssel bekommst du bei Anthropic unter console.anthropic.com → „API Keys“. Er wird verschlüsselt auf diesem Gerät gespeichert und nur an api.anthropic.com geschickt. ',
      h('strong', { text: 'Tipp:' }), ' Stell dort unter „Limits“ ein monatliches Ausgabenlimit ein, dann kann nie mehr als geplant abgebucht werden.'));
  }

  // ---------- Modell ----------
  function drawModel() {
    const current = store.settings.model;
    replace(modelGroup, h('div', { class: 'group', role: 'radiogroup', 'aria-label': 'Modell' },
      Object.entries(MODELS).map(([id, m]) => h('button', {
        class: 'cell radio-cell', type: 'button', role: 'radio', 'aria-checked': String(id === current),
        onClick: async () => { await store.setSettings({ model: id }); drawModel(); },
      },
      h('span', { class: 'tick' }, id === current ? icon('check', 20) : null),
      h('span', { class: 'radio-text' }, m.name, h('span', { class: 'sub', text: `${m.note} ${m.estimate}.` }))))),
    h('p', { class: 'help', text: 'Jede Analyse besteht aus zwei Durchgängen: Entwurf und Selbstprüfung. Die Kosten sind grobe Schätzungen und hängen davon ab, wie viele frühere Einträge einbezogen werden.' }));
  }

  // ---------- Verbrauch ----------
  function drawUsage() {
    const month = store.kv('usage')[monthKey()] || {};
    let requests = 0; let cost = 0;
    for (const m of Object.values(month)) { requests += m.requests || 0; cost += m.cost || 0; }
    replace(usageWrap, h('div', { class: 'group' },
      h('div', { class: 'cell' }, h('span', { text: 'Diesen Monat' }), h('span', { class: 'val', text: requests ? `${requests} Anfragen · ca. ${fmtMoney(cost)}` : 'noch nichts' }))),
    h('p', { class: 'help', text: 'Auf dem Gerät geschätzt aus den Angaben der Antworten. Maßgeblich ist die Abrechnung in deinem Anthropic-Konto.' }));
  }

  drawKey();
  drawModel();
  drawUsage();

  // ---------- Sicherheit ----------
  function changeCode() {
    openSheet((close) => {
      const oldIn = h('input', { class: 'input', type: 'password', id: 'c-old', autocomplete: 'current-password' });
      const newIn = h('input', { class: 'input', type: 'password', id: 'c-new', autocomplete: 'new-password' });
      const repIn = h('input', { class: 'input', type: 'password', id: 'c-rep', autocomplete: 'new-password' });
      const err = h('p', { class: 'error-text', role: 'alert' });
      const btn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Code ändern');
      btn.addEventListener('click', async () => {
        err.textContent = '';
        if (newIn.value.length < 4) { err.textContent = 'Der neue Code braucht mindestens 4 Zeichen.'; return; }
        if (newIn.value !== repIn.value) { err.textContent = 'Die beiden neuen Codes stimmen nicht überein.'; return; }
        btn.disabled = true;
        btn.textContent = 'Wird geändert …';
        try {
          await store.changeCode(oldIn.value, newIn.value);
          close();
          toast('Code geändert');
        } catch (e) {
          err.textContent = e instanceof WrongCodeError ? 'Der bisherige Code stimmt nicht.' : `Fehler: ${e.message}`;
          btn.disabled = false;
          btn.textContent = 'Code ändern';
        }
      });
      return [
        h('h2', { text: 'Code ändern' }),
        h('div', { class: 'field' }, h('label', { for: 'c-old', text: 'Bisheriger Code' }), oldIn),
        h('div', { class: 'field' }, h('label', { for: 'c-new', text: 'Neuer Code (mind. 4 Zeichen)' }), newIn),
        h('div', { class: 'field' }, h('label', { for: 'c-rep', text: 'Neuen Code wiederholen' }), repIn),
        err,
        h('div', { class: 'stack' }, btn, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: close }, 'Abbrechen')),
      ];
    });
  }

  const lockSelect = h('select', { class: 'select', id: 'autolock', 'aria-label': 'Automatisch sperren' },
    AUTO_LOCK_OPTIONS.map((o) => h('option', { value: String(o.value), selected: o.value === getAutoLockMinutes() }, o.label)));
  lockSelect.value = String(getAutoLockMinutes());
  lockSelect.addEventListener('change', () => { setAutoLockMinutes(Number(lockSelect.value)); toast('Gespeichert'); });

  // ---------- Daten ----------
  async function exportEncrypted() {
    const file = await buildEncryptedBackup();
    openSheet((close) => [
      h('h2', { text: 'Backup bereit' }),
      h('p', { text: `${file.count} ${file.count === 1 ? 'Eintrag' : 'Einträge'}, verschlüsselt. Öffnen lässt sich das Backup nur mit deinem jetzigen Code. Der API-Schlüssel ist nicht enthalten.` }),
      h('p', { text: 'Auf dem iPhone: „In Dateien sichern“ wählen, z. B. in iCloud Drive.' }),
      h('div', { class: 'stack' },
        h('button', {
          class: 'btn btn-primary btn-block', type: 'button',
          onClick: async () => {
            suspendAutoLock();
            const res = await deliverFile(file);
            resumeAutoLock();
            if (res !== 'cancelled') { close(); toast('Backup gesichert'); }
          },
        }, 'Datei sichern'),
        h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: close }, 'Abbrechen')),
    ]);
  }

  async function exportPlain() {
    const ok = await confirmSheet({
      title: 'Lesbare Kopie exportieren?',
      text: 'Diese Datei ist nicht verschlüsselt. Jeder, der sie öffnet, kann alle Einträge lesen. Für eine Sicherung ist das verschlüsselte Backup besser.',
      confirm: 'Trotzdem exportieren',
    });
    if (!ok) return;
    const file = buildPlainExport();
    openSheet((close) => [
      h('h2', { text: 'Export bereit' }),
      h('p', { text: `${file.count} ${file.count === 1 ? 'Eintrag' : 'Einträge'}, unverschlüsselt.` }),
      h('div', { class: 'stack' },
        h('button', {
          class: 'btn btn-primary btn-block', type: 'button',
          onClick: async () => {
            suspendAutoLock();
            const res = await deliverFile(file);
            resumeAutoLock();
            if (res !== 'cancelled') close();
          },
        }, 'Datei sichern'),
        h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: close }, 'Abbrechen')),
    ]);
  }

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    resumeAutoLock();
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const parsed = readImportFile(await file.text());
      if (parsed.kind === 'plain') {
        const r = await store.importEntries(parsed.data.entries);
        toast(`${r.added} neu, ${r.updated} aktualisiert, ${r.skipped} übersprungen`, 3200);
        return;
      }
      openSheet((close) => {
        const codeIn = h('input', { class: 'input', type: 'password', id: 'imp-code', autocomplete: 'off' });
        const err = h('p', { class: 'error-text', role: 'alert' });
        const btn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Importieren');
        btn.addEventListener('click', async () => {
          err.textContent = '';
          btn.disabled = true;
          btn.textContent = 'Wird entschlüsselt …';
          try {
            const list = await decryptBackup(parsed.data, codeIn.value);
            const r = await store.importEntries(list);
            close();
            toast(`${r.added} neu, ${r.updated} aktualisiert, ${r.skipped} übersprungen`, 3200);
          } catch (e) {
            err.textContent = e instanceof WrongCodeError ? 'Der Code passt nicht zu diesem Backup.' : `Fehler: ${e.message}`;
            btn.disabled = false;
            btn.textContent = 'Importieren';
          }
        });
        return [
          h('h2', { text: 'Backup importieren' }),
          h('p', { text: `${parsed.data.entries.length} Einträge. Gib den Code ein, der beim Sichern galt. Vorhandene Einträge bleiben erhalten.` }),
          h('div', { class: 'field' }, h('label', { for: 'imp-code', text: 'Code des Backups' }), codeIn),
          err,
          h('div', { class: 'stack' }, btn, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: close }, 'Abbrechen')),
        ];
      });
    } catch (e) {
      toast(e.message, 4000);
    }
  });

  function wipe() {
    openSheet((close) => {
      const input = h('input', { class: 'input', type: 'text', id: 'wipe-confirm', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'LÖSCHEN' });
      const btn = h('button', { class: 'btn btn-danger btn-block', type: 'button', disabled: true }, 'Alles endgültig löschen');
      input.addEventListener('input', () => { btn.disabled = input.value.trim().toUpperCase() !== 'LÖSCHEN'; });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Wird gelöscht …';
        await store.wipe();
        clearPrefs();
        location.replace(location.pathname);
      });
      return [
        h('h2', { text: 'Alle Daten löschen?' }),
        h('p', { text: 'Alle Einträge, Analysen, der API-Schlüssel und der Code werden von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen. Bereits an Anthropic gesendete Texte liegen dort nach deren Regeln noch eine begrenzte Zeit.' }),
        h('div', { class: 'field' }, h('label', { for: 'wipe-confirm', text: 'Zur Bestätigung LÖSCHEN eingeben' }), input),
        h('div', { class: 'stack' }, btn, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: close }, 'Abbrechen')),
      ];
    });
  }

  const cell = (text, onClick, cls = '') => h('button', { class: `cell ${cls}`, type: 'button', onClick }, h('span', { text }), icon('chevronRight', 16));

  const privacy = h('div', { class: 'group' }, h('div', { class: 'cell-block prose' },
    h('p', {}, h('strong', { text: 'Wo deine Einträge liegen: ' }), 'nur auf diesem Gerät, verschlüsselt mit AES-256. Der Schlüssel dafür wird aus deinem Code abgeleitet; der Code selbst wird nirgends gespeichert. Ohne Code kann niemand die Einträge lesen – auch du nicht, wenn du ihn vergisst.'),
    h('p', {}, h('strong', { text: 'Was es nicht gibt: ' }), 'kein Konto, keinen eigenen Server, keine Werbung, keine Tracker oder Analyse-Tools, kein Teilen, keine öffentlichen Profile.'),
    h('p', {}, h('strong', { text: 'Was das Gerät verlässt: ' }), 'nur wenn du „Analysieren“, „Journal fragen“ oder „Muster suchen“ antippst. Dann gehen direkt und verschlüsselt (HTTPS) an Anthropic, den Anbieter des Sprachmodells Claude: der Eintrag bzw. deine Frage, die dazu ausgewählten früheren Einträge und einfache Zählungen. Welche Einträge das waren, siehst du unter jeder Antwort bei „Grundlage“. Die App kann technisch mit keiner anderen Adresse sprechen.'),
    h('p', {}, h('strong', { text: 'Ehrlich gesagt: ' }), 'Das ist keine Ende-zu-Ende-Verschlüsselung. Damit das Modell deine Texte analysieren kann, muss Anthropic sie lesen können. Anthropic gibt an, über die API gesendete Daten standardmäßig nicht zum Training seiner Modelle zu verwenden, bewahrt sie aber für eine begrenzte Zeit auf (z. B. zur Missbrauchserkennung). Die genauen Regeln stehen in Anthropics Datenschutzhinweisen.'),
    h('p', {}, h('strong', { text: 'Grenzen des Schutzes: ' }), 'Solange das Notizbuch geöffnet ist, sind die Daten im Arbeitsspeicher entschlüsselt. Ein kurzer Code (z. B. vier Ziffern) lässt sich mit Zugriff auf die Gerätedaten und Rechenaufwand durchprobieren – ein längerer Code schützt deutlich besser. Wenn du die App vom Home-Bildschirm löschst, sind auch die Daten weg; sichere deshalb ab und zu ein Backup.')));

  const el = h('div', { class: 'page' },
    topbar({ fallback: '#/heute' }),
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', { class: 'page-title', text: 'Einstellungen' }))),

    label('Analyse'),
    keyGroup,
    label('Modell'),
    modelGroup,
    label('Verbrauch'),
    usageWrap,

    label('Sicherheit'),
    h('div', { class: 'group' },
      cell('Code ändern', changeCode),
      h('div', { class: 'cell' }, h('label', { for: 'autolock', text: 'Automatisch sperren' }), h('div', { class: 'val' }, lockSelect)),
      h('button', { class: 'cell accent', type: 'button', onClick: () => document.dispatchEvent(new CustomEvent('nb:lock')) }, h('span', { text: 'Jetzt sperren' }), icon('lock', 18))),
    h('p', { class: 'help', text: 'Gesperrt wird, wenn die App so lange im Hintergrund war.' }),

    label('Darstellung'),
    segmented([{ value: 'system', label: 'Automatisch' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }], getTheme(), setTheme, 'Darstellung'),

    label('Daten'),
    h('div', { class: 'group' },
      cell('Backup sichern (verschlüsselt)', () => exportEncrypted().catch((e) => toast(e.message, 4000))),
      cell('Lesbare Kopie exportieren', () => exportPlain().catch((e) => toast(e.message, 4000))),
      cell('Backup oder Export importieren', () => { suspendAutoLock(); fileInput.click(); }),
      h('button', { class: 'cell danger', type: 'button', onClick: wipe }, h('span', { text: 'Alle Daten löschen' }))),
    fileInput,

    label('Datenschutz'),
    privacy,

    h('p', { class: 'help', text: 'Notizbuch · Version 1.0' }));

  const offs = [store.on('kv:usage', drawUsage)];
  return { el, unmount() { offs.forEach((off) => off()); } };
}
