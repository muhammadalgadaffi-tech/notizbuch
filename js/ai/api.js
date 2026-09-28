// ==========================================================================
// DATENFLUSS NACH AUSSEN – DIES IST DIE EINZIGE STELLE, DIE DATEN VERSCHICKT.
// ==========================================================================
//
// Empfänger: Anthropic (Anbieter des Sprachmodells Claude), https://api.anthropic.com
// Verbindung: direkt vom Gerät, verschlüsselt über HTTPS. Es gibt keinen eigenen Server dazwischen.
//
// Was genau verschickt wird, steht in `body` in der Funktion `askModel` unten:
//   - system:   die festen Anweisungen aus prompts.js (enthalten keine persönlichen Daten)
//   - messages: das Material, das tasks.js zusammenstellt – je nach Aktion
//               • Analyse:        der Eintrag, lokal ausgewählte frühere Einträge, Zählungen
//               • Journal fragen: deine Frage und die dazu ausgewählten Einträge
//               • Muster suchen:  die Einträge aus dem gewählten Zeitraum und Zählungen
//   - Header x-api-key: dein API-Schlüssel (nur an api.anthropic.com)
// Nie verschickt werden: dein Code, der Tresor, andere Einträge als die ausgewählten.
//
// Die Sicherheitsregel (Content-Security-Policy) in index.html erlaubt dem Browser
// ausschließlich Verbindungen zu api.anthropic.com – jede andere Adresse wird blockiert.
//
// Warum ohne offizielles SDK? Die App hat bewusst keinen Build-Schritt und lädt keine
// fremden Bibliotheken. So bleibt nachvollziehbar, dass nur dieser eine Aufruf existiert.
// ==========================================================================

const API = 'https://api.anthropic.com/v1';
const TIMEOUT_MS = 150000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const NO_FALLBACK_FLAG = 'nb.noFallback';

// Preise in US-Dollar pro 1 Million Tokens (Stand der Entwicklung, Anthropic-Preisliste).
export const MODELS = {
  'claude-opus-5': {
    name: 'Opus 5',
    note: 'Gründlichste Analyse. Standard.',
    estimate: 'grob 10–25 Cent pro Analyse',
    price: { in: 5, out: 25 },
    effort: true,
    fallback: true,
  },
  'claude-sonnet-5': {
    name: 'Sonnet 5',
    note: 'Etwas weniger gründlich, deutlich günstiger.',
    estimate: 'grob 4–10 Cent pro Analyse',
    price: { in: 2, out: 10 },
    effort: true,
    fallback: false,
  },
  'claude-haiku-4-5': {
    name: 'Haiku 4.5',
    note: 'Schnell und am günstigsten, einfachere Analyse.',
    estimate: 'grob 1–3 Cent pro Analyse',
    price: { in: 1, out: 5 },
    effort: false,
    fallback: false,
  },
};

export const DEFAULT_MODEL = 'claude-opus-5';

export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'api', retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.retryable = retryable;
  }
}

function headers(apiKey, extra = {}) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Erlaubt den direkten Aufruf aus dem Browser. Der Schlüssel bleibt auf deinem Gerät.
    'anthropic-dangerous-direct-browser-access': 'true',
    ...extra,
  };
}

function fallbackAllowed() {
  try { return localStorage.getItem(NO_FALLBACK_FLAG) !== '1'; } catch { return true; }
}
function disableFallback() {
  try { localStorage.setItem(NO_FALLBACK_FLAG, '1'); } catch { /* egal */ }
}

async function readError(res) {
  let msg = '';
  try {
    const j = await res.json();
    msg = j?.error?.message || '';
  } catch { /* keine lesbare Fehlermeldung */ }
  return msg;
}

function errorFor(status, msg) {
  const m = msg.toLowerCase();
  if (status === 401) return new ApiError('Der API-Schlüssel wird nicht akzeptiert. Prüfe ihn in den Einstellungen.', { status, kind: 'auth' });
  if (status === 402 || m.includes('credit balance') || m.includes('billing')) {
    return new ApiError('Bei Anthropic ist kein Guthaben mehr vorhanden oder die Zahlung fehlt. Lade dein Guthaben in der Anthropic Console auf.', { status, kind: 'billing' });
  }
  if (status === 403) return new ApiError('Dieser Schlüssel hat keinen Zugriff auf das gewählte Modell. Prüfe dein Anthropic-Konto.', { status, kind: 'permission' });
  if (status === 404) return new ApiError('Das gewählte Modell ist für deinen Schlüssel nicht verfügbar. Wähle in den Einstellungen ein anderes.', { status, kind: 'model' });
  if (status === 413) return new ApiError('Die Anfrage war zu groß.', { status });
  if (status === 429) return new ApiError('Gerade zu viele Anfragen oder dein Ausgabenlimit ist erreicht. Warte kurz und versuche es erneut.', { status, kind: 'rate', retryable: true });
  if (status >= 500) return new ApiError('Der Dienst ist gerade überlastet. Versuche es in ein paar Minuten erneut.', { status, kind: 'server', retryable: true });
  return new ApiError(`Die Anfrage wurde abgelehnt (Fehler ${status}).${msg ? ` ${msg}` : ''}`, { status });
}

async function send(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ApiError('Die Antwort hat zu lange gedauert. Versuche es erneut.', { kind: 'timeout', retryable: true });
    if (!navigator.onLine) throw new ApiError('Keine Internetverbindung. Dein Eintrag ist gespeichert – die Analyse kannst du später starten.', { kind: 'offline' });
    throw new ApiError('Verbindung fehlgeschlagen. Dein Eintrag ist gespeichert – versuche es später erneut.', { kind: 'network', retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Eine Anfrage an das Modell. Antwort ist immer JSON nach `schema`.
 * @returns {Promise<{result: object, usage: object, model: string}>}
 */
export async function askModel({ apiKey, model, system, data, task, schema, effort = 'medium' }) {
  if (!apiKey) throw new ApiError('Es ist noch kein API-Schlüssel hinterlegt.', { kind: 'nokey' });
  const cfg = MODELS[model] || MODELS[DEFAULT_MODEL];
  const modelId = MODELS[model] ? model : DEFAULT_MODEL;

  const build = (withFallback) => {
    const body = {
      model: modelId,
      max_tokens: 16000,
      // Feste Anweisungen – für alle Anfragen gleich, daher zwischengespeichert (spart Kosten).
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          // Das Material (Einträge). Bei der Selbstprüfung identisch → wird wiederverwendet.
          { type: 'text', text: data, cache_control: { type: 'ephemeral' } },
          // Die konkrete Aufgabe.
          { type: 'text', text: task },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema } },
    };
    if (cfg.effort) body.output_config.effort = effort;
    const extra = {};
    if (withFallback) {
      body.fallbacks = 'default';
      extra['anthropic-beta'] = FALLBACK_BETA;
    }
    return { body, extra };
  };

  let withFallback = cfg.fallback && fallbackAllowed();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { body, extra } = build(withFallback);
    let res;
    try {
      res = await send(`${API}/messages`, { method: 'POST', headers: headers(apiKey, extra), body: JSON.stringify(body) });
    } catch (err) {
      if (err.retryable && attempt < 2) { await wait(2500); continue; }
      throw err;
    }

    if (!res.ok) {
      const msg = await readError(res);
      // Falls die Rückfall-Funktion für dieses Konto nicht freigeschaltet ist: ohne sie erneut versuchen.
      if (res.status === 400 && withFallback && /anthropic-beta|fallback/i.test(msg)) {
        disableFallback();
        withFallback = false;
        continue;
      }
      const err = errorFor(res.status, msg);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      if (err.retryable && attempt < 2 && retryAfter <= 20) { await wait(Math.max(2500, retryAfter * 1000)); continue; }
      throw err;
    }

    let json;
    try { json = await res.json(); } catch { throw new ApiError('Die Antwort konnte nicht gelesen werden. Versuche es erneut.', { kind: 'parse', retryable: true }); }

    if (json.stop_reason === 'refusal') {
      throw new ApiError('Zu diesem Inhalt wurde keine Antwort erstellt.', { kind: 'refusal' });
    }
    if (json.stop_reason === 'max_tokens') {
      throw new ApiError('Die Antwort war unvollständig. Versuche es erneut.', { kind: 'truncated', retryable: true });
    }
    const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      if (attempt < 2) continue;
      throw new ApiError('Die Antwort konnte nicht gelesen werden. Versuche es erneut.', { kind: 'parse', retryable: true });
    }
    return { result, usage: json.usage || {}, model: json.model || modelId };
  }
}

/** Prüft den Schlüssel, ohne Kosten zu verursachen (fragt nur die Modellliste ab). */
export async function testKey(apiKey) {
  if (!apiKey) throw new ApiError('Kein Schlüssel eingegeben.', { kind: 'nokey' });
  const res = await send(`${API}/models?limit=1`, { method: 'GET', headers: headers(apiKey) });
  if (!res.ok) throw errorFor(res.status, await readError(res));
  return true;
}

/** Geschätzte Kosten einer Anfrage in US-Dollar. */
export function costOf(model, usage = {}) {
  const p = (MODELS[model] || MODELS[DEFAULT_MODEL]).price;
  const input = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const output = usage.output_tokens || 0;
  return (input * p.in + write * p.in * 1.25 + read * p.in * 0.1 + output * p.out) / 1e6;
}
