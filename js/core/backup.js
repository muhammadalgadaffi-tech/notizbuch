// Sichern und Wiederherstellen.
// - Verschlüsseltes Backup: die Einträge genau so, wie sie gespeichert sind, plus die Tresordaten.
//   Öffnen lässt es sich nur mit dem Code, der beim Sichern galt. Der API-Schlüssel ist nicht enthalten.
// - Lesbarer Export: alle Einträge als normale JSON-Datei (unverschlüsselt!).

import { store } from './store.js';
import { openVault, unseal, vaultToJSON, vaultFromJSON, recordToJSON, recordFromJSON } from './crypto.js';
import { dayKey } from './dates.js';

export async function buildEncryptedBackup() {
  const dump = await store.rawDump();
  const data = {
    format: 'notizbuch-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    hinweis: 'Verschlüsseltes Backup. Zum Öffnen in der App unter Einstellungen > Importieren den Code eingeben, der beim Sichern galt.',
    vault: vaultToJSON(dump.vault),
    entries: dump.entries.map(([id, rec]) => [id, recordToJSON(rec)]),
  };
  return { name: `notizbuch-backup-${dayKey(new Date())}.json`, json: JSON.stringify(data), count: data.entries.length };
}

export function buildPlainExport() {
  const data = {
    format: 'notizbuch-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    hinweis: 'Diese Datei ist NICHT verschlüsselt.',
    entries: store.all(),
  };
  return { name: `notizbuch-export-${dayKey(new Date())}.json`, json: JSON.stringify(data, null, 2), count: data.entries.length };
}

/** Datei an den Nutzer geben: über „Teilen → In Dateien sichern“ oder als Download. Muss direkt nach einem Antippen aufgerufen werden. */
export async function deliverFile({ name, json }) {
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // sonst: auf Download ausweichen
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export function readImportFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Die Datei ist keine gültige Sicherung.'); }
  if (data?.format === 'notizbuch-backup' && data.vault && Array.isArray(data.entries)) return { kind: 'encrypted', data };
  if (data?.format === 'notizbuch-export' && Array.isArray(data.entries)) return { kind: 'plain', data };
  throw new Error('Unbekanntes Dateiformat. Erwartet wird ein Backup oder Export aus dieser App.');
}

/** Entschlüsselt ein Backup mit dem Code, der beim Sichern galt. */
export async function decryptBackup(data, code) {
  const key = await openVault(vaultFromJSON(data.vault), code);
  const out = [];
  for (const [id, rec] of data.entries) {
    try { out.push(await unseal(key, recordFromJSON(rec), `entry:${id}`)); } catch { /* beschädigter Eintrag wird übersprungen */ }
  }
  return out;
}
