// Kleine Helfer, um Oberflächen-Bausteine zu bauen.
// Wichtig: Nutzertexte werden immer als Text eingesetzt (nie als HTML),
// damit kein eingeschleuster Code ausgeführt werden kann.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'required', 'multiple']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

// ---------- Symbole (schlichte Linien, 24er Raster) ----------

const ICONS = {
  write: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  book: ['M6 4h11.5A1.5 1.5 0 0 1 19 5.5V20H7.5A2.5 2.5 0 0 1 5 17.5V5a1 1 0 0 1 1-1z', 'M5 17.5A2.5 2.5 0 0 1 7.5 15H19'],
  pattern: [{ c: [6, 17, 2.2] }, { c: [12, 6.5, 2.2] }, { c: [18, 15, 2.2] }, 'M7.2 15.1l3.6-6.6', 'M13.4 8.3l3.3 4.9', 'M8.2 17.2l7.6-1.7'],
  search: [{ c: [10.5, 10.5, 6] }, 'M15 15l5 5'],
  settings: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', { c: [15, 7, 2] }, { c: [9, 17, 2] }],
  lock: ['M6.5 11h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  back: ['M14.5 5l-7 7 7 7'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  more: [{ c: [5.5, 12, 1.4], fill: true }, { c: [12, 12, 1.4], fill: true }, { c: [18.5, 12, 1.4], fill: true }],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  arrow: ['M5 12h13', 'M13 6.5l5.5 5.5-5.5 5.5'],
};

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name, size = 22) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ICONS[name] || []) {
    let node;
    if (typeof part === 'string') {
      node = document.createElementNS(SVG, 'path');
      node.setAttribute('d', part);
    } else {
      node = document.createElementNS(SVG, 'circle');
      node.setAttribute('cx', part.c[0]);
      node.setAttribute('cy', part.c[1]);
      node.setAttribute('r', part.c[2]);
      if (part.fill) { node.setAttribute('fill', 'currentColor'); node.setAttribute('stroke', 'none'); }
    }
    svg.append(node);
  }
  return svg;
}

// Textfeld wächst mit dem Inhalt mit.
export function autoGrow(textarea) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}
