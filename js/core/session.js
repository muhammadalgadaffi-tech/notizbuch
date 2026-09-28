// Automatisches Sperren kurz aussetzen – z. B. während die Dateiauswahl oder das Teilen-Menü offen ist,
// denn iOS schickt die App dabei kurz in den Hintergrund.

let suspendedUntil = 0;

export function suspendAutoLock(ms = 180000) { suspendedUntil = Date.now() + ms; }
export function resumeAutoLock() { suspendedUntil = 0; }
export function autoLockSuspended() { return Date.now() < suspendedUntil; }
