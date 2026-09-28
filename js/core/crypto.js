// Verschlüsselung mit der eingebauten Web-Crypto-Schnittstelle des Browsers.
//
// So funktioniert es:
// 1. Beim Anlegen wird ein zufälliger Datenschlüssel (AES-256) erzeugt.
// 2. Aus deinem Code wird mit PBKDF2 (600.000 Runden, SHA-256) ein zweiter Schlüssel abgeleitet.
//    Mit ihm wird der Datenschlüssel verschlüsselt abgelegt. Dein Code selbst wird nie gespeichert.
// 3. Jeder Eintrag und jede Einstellung wird mit dem Datenschlüssel (AES-GCM) verschlüsselt.
//    Ein falscher Code lässt sich daran erkennen, dass das Entschlüsseln fehlschlägt.
//
// Grenzen (ehrlich): Solange das Notizbuch geöffnet ist, liegen die Daten entschlüsselt
// im Arbeitsspeicher. Ein sehr kurzer Code kann mit Zugriff auf die Gerätedaten und viel
// Rechenaufwand durchprobiert werden – ein längerer Code schützt deutlich besser.

const ITERATIONS = 600000;
const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('Verschlüsselung ist in diesem Browser nicht verfügbar (nur über https möglich).');
  return crypto.subtle;
};

export class WrongCodeError extends Error {
  constructor() { super('Falscher Code'); this.name = 'WrongCodeError'; }
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function deriveKey(code, salt, iterations) {
  const base = await subtle().importKey('raw', te.encode(code.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function importDataKey(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function lockRawKey(raw, code) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kek = await deriveKey(code, salt, ITERATIONS);
  const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, raw));
  return { v: 1, salt, iv, iterations: ITERATIONS, wrapped };
}

async function unlockRawKey(vault, code) {
  const kek = await deriveKey(code, vault.salt, vault.iterations);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: vault.iv }, kek, vault.wrapped));
  } catch {
    throw new WrongCodeError();
  }
}

/** Neuen Tresor anlegen. Gibt die zu speichernden Tresordaten und den Arbeitsschlüssel zurück. */
export async function createVault(code) {
  const raw = randomBytes(32);
  const vault = { ...(await lockRawKey(raw, code)), createdAt: new Date().toISOString() };
  const key = await importDataKey(raw);
  raw.fill(0);
  return { vault, key };
}

/** Tresor mit Code öffnen. Wirft WrongCodeError bei falschem Code. */
export async function openVault(vault, code) {
  const raw = await unlockRawKey(vault, code);
  const key = await importDataKey(raw);
  raw.fill(0);
  return key;
}

/** Code ändern: Datenschlüssel bleibt gleich, nur seine Verpackung wird erneuert. */
export async function changeVaultCode(vault, oldCode, newCode) {
  const raw = await unlockRawKey(vault, oldCode);
  const next = { ...(await lockRawKey(raw, newCode)), createdAt: vault.createdAt };
  raw.fill(0);
  return next;
}

/** Objekt verschlüsseln. `label` bindet den Geheimtext an seinen Speicherplatz. */
export async function seal(key, value, label) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(label) },
    key,
    te.encode(JSON.stringify(value)),
  );
  return { iv, ct: new Uint8Array(ct) };
}

export async function unseal(key, record, label) {
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: record.iv, additionalData: te.encode(label) },
    key,
    record.ct,
  );
  return JSON.parse(td.decode(pt));
}

// ---------- Hilfen für Backup-Dateien ----------

export function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function vaultToJSON(v) {
  return { v: v.v, iterations: v.iterations, createdAt: v.createdAt, salt: toBase64(v.salt), iv: toBase64(v.iv), wrapped: toBase64(v.wrapped) };
}

export function vaultFromJSON(j) {
  return { v: j.v, iterations: j.iterations, createdAt: j.createdAt, salt: fromBase64(j.salt), iv: fromBase64(j.iv), wrapped: fromBase64(j.wrapped) };
}

export function recordToJSON(r) {
  return { iv: toBase64(r.iv), ct: toBase64(r.ct) };
}

export function recordFromJSON(j) {
  return { iv: fromBase64(j.iv), ct: fromBase64(j.ct) };
}
