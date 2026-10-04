// Oberfläche für den Weg über das Claude-Abo: drei Schritte und die Darstellung von Claudes Antwort.

import { h, icon, autoGrow } from '../core/dom.js';
import { store } from '../core/store.js';
import { fmtShortDay, fmtTime } from '../core/dates.js';
import { CLAUDE_URL, copyState, parseAnswer, checkPasted } from '../ai/abo.js';
import { toast } from './components.js';

/**
 * Drei Schritte: kopieren → Claude öffnen → Antwort einfügen.
 * @param {object} o
 * @param {string} o.copyKey      Schlüssel für den Kopier-Status
 * @param {Function} o.onCopy     kopiert erneut (direkt beim Antippen)
 * @param {Function} o.onSave     (text) => Promise
 * @param {Function} [o.onCancel]
 * @param {string} [o.what]       z. B. „Eintrag und 5 frühere Einträge“
 */
export function aboBox({ copyKey, onCopy, onSave, onCancel, what = '' }) {
  const step1 = h('div', { class: 'abo-step-body' });

  function drawStep1() {
    const st = copyState(copyKey);
    step1.replaceChildren();
    if (st?.status === 'ok') {
      step1.append(
        h('p', { class: 'abo-done' }, icon('check', 18), ' Auftrag kopiert', what ? h('span', { class: 'muted', text: ` · ${what}` }) : null),
        h('button', { class: 'btn btn-quiet abo-again', type: 'button', onClick: copyAgain }, 'Nochmal kopieren'));
    } else if (st?.status === 'pending') {
      step1.append(h('p', { class: 'muted', text: 'Wird kopiert …' }));
      st.promise.then(drawStep1);
    } else {
      step1.append(h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: copyAgain }, 'Auftrag kopieren'));
      if (st?.status === 'failed') {
        const ta = h('textarea', { class: 'textarea abo-manual', readOnly: true, rows: 4, value: st.text, 'aria-label': 'Auftrag zum Kopieren' });
        step1.append(
          h('p', { class: 'error-text', text: 'Automatisches Kopieren hat nicht geklappt. Tippe ins Feld, wähle „Alles auswählen“ und dann „Kopieren“.' }),
          ta);
      }
    }
  }

  function copyAgain() {
    onCopy();
    drawStep1();
    const st = copyState(copyKey);
    st?.promise.then((ok) => { if (ok) toast('Auftrag kopiert'); });
  }

  const answer = h('textarea', {
    class: 'textarea abo-answer', rows: 4, placeholder: 'Claudes Antwort hier einfügen',
    'aria-label': 'Claudes Antwort', autocomplete: 'off', spellcheck: 'false',
  });
  autoGrow(answer);
  const err = h('p', { class: 'error-text', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary grow', type: 'button', disabled: true }, 'Antwort speichern');
  const paste = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Einfügen');

  const refresh = () => { save.disabled = !answer.value.trim(); err.textContent = ''; };
  answer.addEventListener('input', refresh);

  paste.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { toast('Die Zwischenablage ist leer.'); return; }
      answer.value = t;
      answer.dispatchEvent(new Event('input'));
      const problem = checkPasted(t);
      if (problem) err.textContent = problem;
    } catch {
      toast('Halte das Feld gedrückt und wähle „Einsetzen“.', 3500);
      answer.focus();
    }
  });

  save.addEventListener('click', async () => {
    const problem = checkPasted(answer.value);
    if (problem) { err.textContent = problem; return; }
    save.disabled = true;
    save.textContent = 'Wird gespeichert …';
    try {
      await onSave(answer.value);
    } catch (e) {
      err.textContent = e.message;
      save.disabled = false;
      save.textContent = 'Antwort speichern';
    }
  });

  drawStep1();

  const step = (n, title, body) => h('li', { class: 'abo-step' },
    h('span', { class: 'abo-num', text: String(n) }),
    h('div', { class: 'abo-step-main' }, h('p', { class: 'abo-step-title', text: title }), body));

  return h('div', { class: 'abo-box' },
    h('ol', { class: 'abo-steps' },
      step(1, 'Auftrag kopieren', step1),
      step(2, 'In Claude einfügen und senden', h('div', {},
        h('a', { class: 'btn btn-secondary btn-block', href: CLAUDE_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Claude öffnen'),
        h('p', { class: 'help', text: 'Neuen Chat öffnen, Text einfügen, senden. Dann unter der Antwort auf „Kopieren“ tippen.' }))),
      step(3, 'Antwort hier einfügen', h('div', {},
        answer,
        err,
        h('div', { class: 'actions' }, paste, save)))),
    h('div', { class: 'abo-foot' },
      h('span', { class: 'small muted', text: 'Läuft über dein Claude-Abo – kostet nichts extra.' }),
      onCancel ? h('button', { class: 'btn btn-quiet', type: 'button', onClick: onCancel }, 'Abbrechen') : null));
}

// ---------- Claudes Antwort darstellen ----------

const INLINE_RE = /\*\*([^*\n]+)\*\*|\[((?:E\d+|NEU)(?:\s*,\s*(?:E\d+|NEU))*)\]|\((naheliegend|möglich|spekulativ)\)/g;

function refLink(label, refMap) {
  if (label === 'NEU') return document.createTextNode('dieser Eintrag');
  const id = refMap.get(label);
  const e = id ? store.get(id) : null;
  if (!e) return document.createTextNode(`[${label}]`);
  return h('a', { class: 'ref', href: `#/eintrag/${encodeURIComponent(id)}`, text: `${fmtShortDay(e.occurredAt)}, ${fmtTime(e.occurredAt)}` });
}

function inline(text, refMap) {
  const frag = document.createDocumentFragment();
  const s = text.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, '$1$2').replace(/__([^_\n]+)__/g, '$1');
  let last = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(s))) {
    if (m.index > last) frag.append(s.slice(last, m.index));
    if (m[1]) frag.append(h('strong', { text: m[1] }));
    else if (m[2]) {
      m[2].split(/\s*,\s*/).forEach((label, i) => {
        if (i) frag.append(' ');
        frag.append(refLink(label, refMap));
      });
    } else if (m[3]) frag.append(h('span', { class: 'kind', text: m[3] }));
    last = INLINE_RE.lastIndex;
  }
  if (last < s.length) frag.append(s.slice(last));
  return frag;
}

/** Zeilen eines Abschnitts: Listen, Unterüberschriften, Absätze. */
function renderLines(lines, refMap) {
  const out = [];
  let list = null;
  let listType = null;
  const flush = () => { if (list) out.push(list); list = null; listType = null; };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    let m = /^#{3,}\s*(.+)$/.exec(t);
    if (m) { flush(); out.push(h('h4', { class: 'abo-sub' }, inline(m[1].replace(/\*\*/g, ''), refMap))); continue; }
    m = /^(?:([-*•–])|(\d+)[.)])\s+(.+)$/.exec(t);
    if (m) {
      const type = m[2] ? 'ol' : 'ul';
      if (!list || listType !== type) { flush(); list = h(type, { class: type === 'ol' ? 'an-list' : 'an-list bullets' }); listType = type; }
      list.append(h('li', {}, inline(m[3], refMap)));
      continue;
    }
    flush();
    if (/^sicherheit\s*:/i.test(t)) out.push(h('p', { class: 'certainty' }, inline(t, refMap)));
    else out.push(h('p', {}, inline(t, refMap)));
  }
  flush();
  return out;
}

const REFLECT = ['Andere Perspektive', 'Was du vielleicht übersiehst', 'Zum Nachdenken'];
const HIDDEN = ['Personen', 'Themen', 'Selbstprüfung', 'Hinweis', 'Rückfragen'];

/**
 * Claudes Antwort als Abschnitte.
 * `reflect` enthält die Denkanstöße (für den grauen Kasten), wenn `splitReflect` gesetzt ist.
 * @returns {{ nodes: Node[], reflect: Node[], special: object, parsed: boolean }}
 */
export function renderAboAnswer(raw, refs, { splitReflect = false } = {}) {
  const refMap = new Map(refs || []);
  const { sections, special } = parseAnswer(raw);
  const nodes = [];
  const reflect = [];
  if (!sections.some((s) => s.title)) {
    // Keine erkennbaren Überschriften: Text so zeigen, wie er kam.
    nodes.push(h('section', { class: 'an-sec' }, renderLines(String(raw).split('\n'), refMap)));
    return { nodes, reflect, special, parsed: false };
  }
  if (special.hinweis) nodes.push(h('div', { class: 'note', role: 'note' }, inline(special.hinweis.replace(/\n/g, ' '), refMap)));
  for (const s of sections) {
    if (s.title && HIDDEN.includes(s.title)) continue;
    const sec = h('section', { class: 'an-sec' }, s.title ? h('h3', { text: s.title }) : null, renderLines(s.lines, refMap));
    if (splitReflect && REFLECT.includes(s.title)) reflect.push(sec);
    else nodes.push(sec);
  }
  return { nodes, reflect, special, parsed: true };
}
