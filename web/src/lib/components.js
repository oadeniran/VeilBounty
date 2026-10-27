// VeilBounty design-system components, rebuilt as plain DOM functions.
// Markup and class names follow the design system's own component bundle (window.VeilBounty.*) so the
// ported stylesheets apply unchanged. Each function returns an element; callers keep references to update it.
import { h, s } from './dom.js';

export const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  alert: 'M12 8.5v5M12 16.6v.01M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 11v6M12 7.6v.01M12 21a9 9 0 100-18 9 9 0 000 18z',
  shield: 'M12 3l7.5 3v5.6c0 4.6-3.2 8.2-7.5 9.4-4.3-1.2-7.5-4.8-7.5-9.4V6L12 3z',
  'shield-check': 'M12 3l7.5 3v5.6c0 4.6-3.2 8.2-7.5 9.4-4.3-1.2-7.5-4.8-7.5-9.4V6L12 3zM8.8 12.2l2.2 2.2 4.2-4.4',
  lock: 'M7 10.5V8a5 5 0 0110 0v2.5M5.5 10.5h13a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1v-8a1 1 0 011-1z',
  device: 'M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 14.5v-9zM9 20h6M12 16v4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z',
  'eye-off': 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-3 3.8M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.4-.6 4.7-1.4M9.9 9.9a2.8 2.8 0 004 4',
  chevron: 'M6 9.5l6 6 6-6',
  copy: 'M9 9.5A1.5 1.5 0 0110.5 8h8A1.5 1.5 0 0120 9.5v9a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 019 18.5v-9zM15 8V5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H9',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  clock: 'M12 7.5V12l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  refresh: 'M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4h-4',
  wallet: 'M4 7.5A2.5 2.5 0 016.5 5H18v3M4 7.5v10A2.5 2.5 0 006.5 20H20v-12H6.5A2.5 2.5 0 014 7.5zM16 14.2v.01',
  file: 'M14 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8L14 3.5zM14 3.5V8h4.5M9 13h6M9 16.5h4',
  key: 'M14.5 9.5a4 4 0 11-8 0 4 4 0 018 0zM13.4 12.4L20 19M17 16l2-2M18.8 17.8l1.6-1.6',
  spark: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9L12 3.5z',
  coin: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17zM9 9.5h6l-6 5h6M12 7.5v2M12 14.5v2',
  send: 'M4 12l16-7.5-6 16-2.5-6.5L4 12z',
  inbox: 'M3.5 13.5l2.6-7.2A1.5 1.5 0 017.5 5.3h9a1.5 1.5 0 011.4 1l2.6 7.2M3.5 13.5V18A1.5 1.5 0 005 19.5h14a1.5 1.5 0 001.5-1.5v-4.5M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5',
  flask: 'M9.5 3.5h5M10.5 3.5v5.2L5 18a1.7 1.7 0 001.5 2.5h11A1.7 1.7 0 0019 18l-5.5-9.3V3.5M7.5 14.5h9',
  dash: 'M6 12h12',
  menu: 'M4 7h16M4 12h16M4 17h16',
};

export function icon(name, { size, title, className } = {}) {
  const el = s('svg', { viewBox: '0 0 24 24', class: ['vb-icon', size === 'sm' && 'vb-icon-sm', className].filter(Boolean).join(' '),
    'aria-hidden': title ? null : 'true', role: title ? 'img' : null, focusable: 'false' });
  if (title) el.append(s('title', {}, title));
  el.append(s('path', { d: PATHS[name] ?? PATHS.info }));
  return el;
}

// Button. state: idle | loading | success | error. Returns the <button>; use setButtonState to change it.
export function button(label, { variant = 'primary', size = 'md', icon: lead, iconAfter, loadingLabel = 'Working', testid, disabled, onClick, className, type = 'button', describedBy } = {}) {
  const el = h('button', { type, class: ['vb-btn', `vb-btn--${variant}`, size !== 'md' && `vb-btn--${size}`, className].filter(Boolean).join(' '),
    'data-testid': testid, disabled, onclick: onClick, 'aria-describedby': describedBy });
  el._vb = { label, lead, iconAfter, loadingLabel };
  setButtonState(el, 'idle');
  return el;
}

export function setButtonState(el, state, label) {
  const o = el._vb; if (label) o.label = label;
  el.dataset.state = state;
  const busy = state === 'loading';
  el.toggleAttribute('aria-busy', busy);
  if (busy) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
  const parts = [];
  if (busy) parts.push(h('span.vb-spinner', { 'aria-hidden': 'true' }), h('span', { text: o.loadingLabel }));
  else {
    if (o.lead) parts.push(icon(o.lead));
    if (o.label) parts.push(h('span', { text: o.label }));
    if (o.iconAfter) parts.push(icon(o.iconAfter));
  }
  el.replaceChildren(...parts);
  el.classList.toggle('vb-btn--icon', !o.label && !busy);
  return el;
}

// Stepper: <ol class="vb-stepper"> with done / current / upcoming / failed pills.
export function stepper(steps, current, { failedAt = -1, label = 'Claim progress' } = {}) {
  const ol = h('ol.vb-stepper', { 'aria-label': label });
  steps.forEach((name, i) => {
    const status = i === failedAt ? 'failed' : i < current ? 'done' : i === current ? 'current' : 'upcoming';
    const word = { done: 'completed', current: 'current step', upcoming: 'not started', failed: 'failed' }[status];
    ol.append(h('li.vb-step', { dataset: { status }, 'aria-current': status === 'current' ? 'step' : null },
      i > 0 ? s('svg', { class: 'vb-step__link', viewBox: '0 0 28 14', 'aria-hidden': 'true' }, s('path', { d: 'M2 10 C 9 2, 19 2, 26 10' })) : null,
      h('span.vb-step__pill',
        h('span.vb-step__dot', { 'aria-hidden': 'true' }, status === 'done' ? icon('check', { size: 'sm' }) : status === 'failed' ? icon('x', { size: 'sm' }) : String(i + 1)),
        name, h('span.vb-sr', `, ${word}`))));
  });
  return ol;
}

// Mobile segmented step bar (responsive board: "segmented step bar" under 640 px).
export function stepSegments(steps, current, { failedAt = -1 } = {}) {
  const segs = h('div.mx-prog__segs', { 'aria-hidden': 'true' },
    steps.map((_, i) => h('i', { dataset: { on: i === failedAt ? 'fail' : i < current ? 'done' : i === current ? 'now' : null } })));
  return h('div.mx-prog', segs, h('span.text-body-sm.vx-muted', `Step ${Math.min(current + 1, steps.length)} of ${steps.length} · ${steps[Math.min(current, steps.length - 1)]}`));
}

const DISCLOSE = {
  reveals: { icon: 'eye', k: 'Buyer learns' }, hidden: { icon: 'eye-off', k: 'Never shared' },
  local: { icon: 'device', k: 'Stays on device' }, shielded: { icon: 'shield', k: 'Shielded' },
};
export function chip(kind, value, label) {
  const d = DISCLOSE[kind] ?? DISCLOSE.reveals;
  return h(`span.vb-chip.vb-chip--${kind}`, icon(d.icon), h('span', h('span.vb-chip__k', `${label ?? d.k}${value ? ': ' : ''}`), value ?? ''));
}

// Screen-level tag (vx-tag). kind: in | out | ok | bad | warn | info
export function tag(kind, text, iconName, extra = {}) {
  const ic = iconName === 'dash' ? s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: PATHS.dash })) : iconName ? icon(iconName, { size: 'sm' }) : null;
  return h(`span.vx-tag.vx-tag--${kind}`, extra, ic, text);
}

const TONE_ICON = { success: 'check', error: 'x', warning: 'alert', info: 'info', active: 'spark', neutral: 'clock' };
// StatusMessage. tone: info | success | warning | error. Errors are role=alert, everything else role=status.
export function msg(tone, title, body, { action, testid, live = true } = {}) {
  return h(`div.vb-msg.vb-msg--${tone}`, { role: live ? (tone === 'error' ? 'alert' : 'status') : null, 'data-testid': testid },
    h('span.vb-msg__ico', { 'aria-hidden': 'true' }, icon(TONE_ICON[tone] ?? 'info')),
    h('div', title ? h('div.vb-msg__title', title) : null, body ? h('div.vb-msg__body', body) : null),
    action ? h('div.vb-msg__action', action) : null);
}

const STATE_TONE = { verified: 'success', done: 'success', active: 'active', failed: 'error', expiring: 'warning', pending: 'neutral' };
const STATE_WORD = { verified: 'Verified', done: 'Done', active: 'In progress', failed: 'Failed', expiring: 'Expiring', pending: 'Waiting' };
// ProofStatus list: items [{ state, title, detail, mono, word, icon }]
export function statusList(items, label) {
  return h('ul.vb-status-list', { 'aria-label': label }, items.map((it) => statusRow(it)));
}
export function statusRow(it) {
  const tone = STATE_TONE[it.state] ?? 'neutral';
  return h('li.vb-status-row', { dataset: { state: it.state } },
    h('span.vb-status-ico', { 'aria-hidden': 'true' }, it.state === 'active' ? h('span.vb-spinner.vb-spinner--sm') : icon(it.icon ?? TONE_ICON[tone], { size: 'sm' })),
    h('span', h('span.vb-status-row__title.is-block', it.title), it.detail ? h('span.vb-status-row__detail.is-block', it.detail) : null,
      it.mono ? h('span.vb-status-row__mono.is-block', it.mono) : null),
    h('span.vb-state-word', { dataset: { tone } }, it.word ?? STATE_WORD[it.state]));
}

let uid = 0;
export const nextId = (p = 'vb') => `${p}-${++uid}`;

// TechDetails disclosure. rows: [{ k, v, copy?: string|false }]
export function techDetails(summary, rows, { iconName = 'key', open = false, testid } = {}) {
  const id = nextId('tech');
  const body = h('div.vb-tech__body', { id, dataset: { open } });
  const inner = h('div.vb-tech__inner');
  if (!open) inner.setAttribute('inert', '');
  const dl = h('dl.vb-kv');
  for (const r of rows) {
    dl.append(h('dt', r.k), h('dd', r.v), h('dd.vb-kv__copy', r.copy === false ? null : copyButton(r.copy ?? r.v, `Copy ${r.k}`)));
  }
  inner.append(dl); body.append(inner);
  const toggle = h('button.vb-tech__toggle', { type: 'button', 'aria-expanded': String(open), 'aria-controls': id, 'data-testid': testid },
    h('span.vb-tech__lead', icon(iconName), summary), icon('chevron'));
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(next)); body.dataset.open = String(next);
    inner.toggleAttribute('inert', !next);
  });
  return h('section.vb-tech.vb-surface.vb-surface--technical', toggle, body);
}

export function copyButton(value, label = 'Copy') {
  const b = h('button.vb-copy', { type: 'button', 'aria-label': label, dataset: { copied: 'false' } }, icon('copy', { size: 'sm' }));
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard may be unavailable; the value is still visible */ }
    b.dataset.copied = 'true'; b.setAttribute('aria-label', 'Copied'); b.replaceChildren(icon('check', { size: 'sm' }));
    setTimeout(() => { b.dataset.copied = 'false'; b.setAttribute('aria-label', label); b.replaceChildren(icon('copy', { size: 'sm' })); }, 1600);
  });
  return b;
}

// Navy reward chip with gradient coin.
export function rewardChip(k, v, { large = false, className } = {}) {
  return h('div.vx-reward', { class: className },
    h('span.vx-coin', { 'aria-hidden': 'true' }, icon('coin')),
    h('span', h('span.vx-reward__k', k), h('span.vx-reward__v.vx-num', { class: large ? 'vx-reward__v--lg' : null }, v)));
}

// The folded-ribbon mark: one PNG plus five masked light layers (see mark.js for behaviour).
export function mark(stage = 'intro', { className } = {}) {
  return h('div.vx-mark', { dataset: { stage }, class: className, 'aria-hidden': 'true' },
    h('img.vx-mark__img', { src: '/brand/vb-mark.png', alt: '', width: 552, height: 362, decoding: 'async' }),
    ['gloss', 'fold', 'veil', 'flow', 'sheen'].map((n) => h(`span.vx-mark__${n}`)));
}

export function curve(className) {
  return s('svg', { class: ['vx-curve', className].filter(Boolean).join(' '), viewBox: '0 0 600 28', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('path', { d: 'M0 20 C 140 20, 180 6, 300 6 S 470 22, 600 10' }));
}

export function laneIcon(name, variant) {
  return h('span.vx-lane__ico', { class: variant ? `vx-lane__ico--${variant}` : null }, icon(name));
}

export function kv(pairs, className) {
  const dl = h('dl.vx-kv', { class: className });
  for (const [k, v, ddClass] of pairs) dl.append(h('dt', k), h('dd', { class: ddClass }, v));
  return dl;
}

const ACT_ICON = { payout: 'coin', proof: 'shield-check', credential: 'file', rejected: 'x', lab: 'flask' };
export function activity(groups, label = 'Activity') {
  return h('div', { role: 'region', 'aria-label': label },
    groups.map((g) => h('section', { 'aria-label': g.day },
      h('div.vb-activity__day', g.day),
      h('ul.vb-activity', g.items.map((it) => h('li.vb-activity__row', { 'data-testid': it.testid },
        h('span.vb-activity__ico', { 'aria-hidden': 'true' }, icon(ACT_ICON[it.kind] ?? 'spark')),
        h('span', h('span.vb-activity__title.is-block', it.title), h('span.vb-activity__sub.is-block', it.sub)),
        h('span.vb-activity__end', it.amount ? h('span.vb-activity__amt', it.amount) : null,
          it.word ? h('span.vb-state-word', { dataset: { tone: it.tone ?? 'neutral' } }, it.word) : null)))))));
}

// SecurityTestResults table: tests [{ name, detail, expected, observed, pass }]
export function testsTable(tests, { title = 'Security tests', ranAt } = {}) {
  const passed = tests.filter((t) => t.pass).length; const all = passed === tests.length;
  return h('section.vb-surface.vb-surface--technical.vb-shape--sharp', { 'aria-label': title },
    h('div.vb-tests__head', h('div', h('div.text-subheading', title), ranAt ? h('div.text-body-sm.vb-muted', ranAt) : null),
      h('span.vb-tests__score', h('span.vb-state-word.is-inline-flex', { dataset: { tone: all ? 'success' : 'error' } },
        icon(all ? 'shield-check' : 'alert', { size: 'sm' }), `${passed} of ${tests.length} passed`))),
    h('div.vb-table-wrap', h('table.vb-table',
      h('thead', h('tr', ['Attack', 'Expected', 'Observed', 'Result'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', tests.map((t) => h('tr',
        h('td', h('div.is-medium', t.name), t.detail ? h('div.vb-muted', t.detail) : null),
        h('td.vb-td-mono', t.expected), h('td.vb-td-mono', t.observed),
        h('td', h('span.vb-state-word.is-inline-flex', { dataset: { tone: t.pass ? 'success' : 'error' } }, icon(t.pass ? 'check' : 'x', { size: 'sm' }), t.pass ? 'Pass' : 'Fail'))))))));
}

export function emptyState({ kind = 'empty', title, body, actions = [] }) {
  return h('div.vb-empty', { dataset: { kind }, role: kind === 'error' ? 'alert' : null },
    s('svg', { class: 'vb-empty__art', viewBox: '0 0 148 112', 'aria-hidden': 'true' },
      s('ellipse', { class: 'a', cx: 80, cy: 60, rx: 64, ry: 44 }), s('ellipse', { class: 'b', cx: 52, cy: 70, rx: 30, ry: 26 }),
      s('path', { class: 'c', d: 'M28 78 C 50 40, 92 40, 120 64' }), s('circle', { class: 'c', cx: 120, cy: 64, r: 5 }),
      s('path', { class: 'c', d: kind === 'error' ? 'M70 44l12 12M82 44L70 56' : 'M66 50h24' })),
    h('div.text-subheading', title), body ? h('p.vb-empty__body.text-body', body) : null,
    actions.length ? h('div.vb-empty__actions', actions) : null);
}
