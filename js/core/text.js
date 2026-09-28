// Textwerkzeuge: Suche ohne Rücksicht auf Groß-/Kleinschreibung und Umlaute,
// Namen im Text finden, grobe Stichwörter bilden.

function normChar(c) {
  if (c === 'ß' || c === 'ẞ') return 'ss';
  return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function norm(s) {
  let out = '';
  for (const c of String(s || '')) out += normChar(c);
  return out;
}

/** Normalisiert und merkt sich für jede Stelle, woher sie im Original kommt. */
function normWithMap(s) {
  let out = '';
  const map = [];
  let i = 0;
  for (const c of String(s || '')) {
    const n = normChar(c);
    for (let k = 0; k < n.length; k++) { out += n[k]; map.push(i); }
    i += c.length;
  }
  map.push(i);
  return { out, map };
}

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const nameReCache = new Map();
/** Findet einen Namen als ganzes Wort (auch „Leons“). */
export function nameRegex(name) {
  const key = norm(name).trim();
  if (!nameReCache.has(key)) {
    nameReCache.set(key, new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(key)}s?(?=$|[^\\p{L}\\p{N}])`, 'u'));
  }
  return nameReCache.get(key);
}

export function mentionsName(text, name) {
  if (!name || !name.trim()) return false;
  return nameRegex(name).test(norm(text));
}

/** Liste aus einer Eingabe wie „Max, Leon und Sarah“. */
export function splitNames(s) {
  return String(s || '')
    .split(/,|;|\/|\s+und\s+|\s+&\s+|\n/i)
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((x) => x.slice(0, 40));
}

export function uniqueCaseless(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = norm(item).trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item.trim());
  }
  return out;
}

const STOP = new Set(`aber alle allem allen aller alles also auch auf aus bei beim bin bis bist bzw dann darum dass dein deine dem den denen denn der des deshalb dich die dies diese diesem diesen dieser dieses dir doch dort durch eben ein eine einem einen einer eines einfach einmal erst etwas euch euer fast für gab gar geben gegen gehabt gerade gestern gewesen gibt ging gut habe haben hat hatte hatten heute hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer immer irgendwie ist jede jedem jeden jeder jetzt kam kann kaum kein keine keinem keinen können könnte machen macht mal man manchmal mehr mein meine meinem meinen meiner mich mir mit muss musste nach nachdem nicht nichts noch nun nur oder ohne schon sehr sein seine seinem seinen seiner seit selbst sich sie sind so sogar soll sollte sondern sonst total über um und uns unser unter viel vielleicht vom von vor wann war waren warum was weil weiter welche wenn wer werde werden wie wieder will wir wird wirklich wo wollte würde zu zum zur zwar zwischen richtig ganz eigentlich einfach irgendwas jemand jemanden heute morgen abend woche wochen tag tage tagen letzte letzten letzter diese dieser diesem danach davor vorher nachher später dabei damit dafür darauf daran halt echt voll mega bisschen wurde wurden würden hätte hätten habe haben irgendwann irgendwo nochmal immer niemand alles andere anderen anders`.split(/\s+/).map(norm));

/** Grobe Wortstämme (erste 5 Buchstaben) für den Vergleich von Einträgen. */
export function stems(text) {
  const out = new Set();
  for (const w of norm(text).split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}

/** Suchbegriffe aus einer Eingabe (für die Stichwortsuche). */
export function searchTerms(q) {
  return norm(q).split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((t) => t.length >= 1);
}

/** Findet Trefferbereiche im Originaltext für die Hervorhebung. */
export function matchRanges(text, terms) {
  if (!terms.length) return [];
  const { out, map } = normWithMap(text);
  const ranges = [];
  for (const t of terms) {
    if (!t) continue;
    let from = 0;
    let idx;
    while ((idx = out.indexOf(t, from)) !== -1) {
      ranges.push([map[idx], map[idx + t.length]]);
      from = idx + t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** Text als DOM-Knoten mit <mark> an den Trefferstellen. */
export function highlight(text, terms) {
  const ranges = matchRanges(text, terms);
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a > pos) frag.append(text.slice(pos, a));
    const m = document.createElement('mark');
    m.textContent = text.slice(a, b);
    frag.append(m);
    pos = b;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}

/** Ausschnitt um den ersten Treffer, damit er in der Liste sichtbar ist. */
export function snippetAround(text, terms, max = 220) {
  const t = String(text || '');
  if (t.length <= max) return t;
  const ranges = matchRanges(t, terms);
  if (!ranges.length || ranges[0][0] < max * 0.6) return t;
  const start = Math.max(0, ranges[0][0] - 60);
  const cut = t.indexOf(' ', start);
  return `…${t.slice(cut > 0 && cut < ranges[0][0] ? cut + 1 : start)}`;
}

export function shorten(text, max = 120) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max - 1);
  return `${t.slice(0, cut > max * 0.6 ? cut : max - 1)}…`;
}

/** Kurzer, stabiler Fingerabdruck eines Textes (um veraltete Analysen zu erkennen). */
export function fingerprint(s) {
  let h1 = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(36);
}
