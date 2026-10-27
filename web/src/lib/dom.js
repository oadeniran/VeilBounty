// Tiny DOM helpers. No innerHTML anywhere: every string goes in through textContent or a text node,
// so nothing from the network or the statement can become markup. No inline style attributes (the CSP forbids them).

const SVG_NS = 'http://www.w3.org/2000/svg';

// h('div.card.wide', { attrs }, ...children). Attribute keys:
//   on*      -> event listener        class / className -> appended classes
//   dataset  -> data-* attributes     text -> textContent
//   boolean true -> present, false/null/undefined -> omitted
export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.classList.add(...classes);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') { if (v) el.classList.add(...String(v).split(/\s+/).filter(Boolean)); }
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = String(dv); }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') { el[k] = !!v; if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { el.replaceChildren(); return el; }
export function mount(el, ...children) { el.replaceChildren(); return append(el, children); }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- formatting ----
export const short = (hex, head = 6, tail = 4) => (hex && hex.length > head + tail + 3 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex ?? '');
export const shortAddr = (a) => short(a, 10, 4);
export const bytesLabel = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export const timeLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const dateTimeLabel = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function elapsedLabel(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
