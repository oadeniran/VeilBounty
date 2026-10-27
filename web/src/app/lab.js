// Security lab (design D7). Three real attempts against the accepted claim:
//   1. edited records, same total  -> runs in the worker; no proof can be built, so nothing is sent
//   2. replay the same claim       -> POST /api/claims, expect already_claimed
//   3. redirect the payout         -> POST /api/claims with another address, expect recipient_mismatch
import { h, mount, short, shortAddr } from '../lib/dom.js';
import { button, tag, msg, icon, testsTable, emptyState, mark } from '../lib/components.js';
import { watchMark } from '../lib/mark.js';
import { S, addHistory, changed } from './store.js';
import { api } from './net.js';
import { call } from './prover.js';
import { explain, REASON_SHORT, shortDate, dollars, capital } from './copy.js';
import { centsFromString, formatCents } from '../../../src/shared/encoding.js';

export const ATTACKER_ADDR = 'utest1attacker' + 'z'.repeat(70) + 'redirect';
let root;

export function renderLab(el, { focus = false } = {}) {
  root = el ?? root;
  if (!root || S.view !== 'lab') return;
  const had = root.contains(document.activeElement) ? document.activeElement.dataset.testid : null;
  mount(root, S.submit.status === 'accepted' ? labBody() : labEmpty());
  if (focus) root.querySelector('[data-view-heading]')?.focus({ preventScroll: true });
  else if (had) (root.querySelector(`[data-testid="${had}"]`) ?? root.querySelector('[data-view-heading]'))?.focus({ preventScroll: true });
}

function labEmpty() {
  return [viewHead(), h('div.vx-content.lab-empty', emptyState({
    title: 'Submit a claim first',
    body: 'Each attempt reuses your accepted claim with one thing changed. Finish the claim flow, then come back and try to cheat the verifier.',
    actions: [button('Go to the claim', { iconAfter: 'arrow', testid: 'lab-go-claim', onClick: () => { location.hash = '#claim'; } })],
  }))];
}

function viewHead(score) {
  return h('div.view-head',
    h('div.view-head__text',
      h('span.text-overline.vx-vtext', 'Security lab'),
      h('h1.text-title', { tabindex: '-1', 'data-view-heading': '' }, 'Try to cheat the verifier'),
      h('p.text-body-lg.vx-muted', 'Each attempt reuses your accepted claim with one thing changed. Two go to the verifier; the edited-records attempt is stopped on this device, because no proof can be built. A safe system rejects all three and pays nothing.')),
    score ?? null);
}

// Predicted edit before it runs: +$10 / −$10 on the first two counted rows (the worker reports the real values).
function predictedTamper() {
  const st = S.statement;
  const idx = st.records.map((r, i) => i).filter((i) => st.counted[i]).slice(0, 2);
  if (idx.length < 2) return null;
  const [a, b] = idx.map((i) => st.records[i]);
  return { dates: [a.date, b.date], from: [a.amount, b.amount], to: [formatCents(centsFromString(a.amount) + 1000), formatCents(centsFromString(b.amount) - 1000)] };
}

const ATTACKS = () => {
  const w = S.words; const nul = S.consent.prepared?.nullifierHex ?? '';
  const t = S.lab.tamper.result?.edited?.length === 2
    ? { dates: S.lab.tamper.result.edited.map((e) => e.date), from: S.lab.tamper.result.edited.map((e) => e.from), to: S.lab.tamper.result.edited.map((e) => e.to) }
    : predictedTamper();
  return [
    { key: 'tamper', icon: 'file', name: 'Edit records, keep the same total', run: runTamper, cta: 'Run tampered records', running: 'Proving on this device…',
      desc: `Moves $10 between two ${w.adj} rows so the ${dollars(S.statement.total)} total is unchanged.`,
      k: t ? `rows ${shortDate(t.dates[0])} / ${shortDate(t.dates[1])}` : 'rows', from: t ? `$${t.from[0]} / $${t.from[1]}` : '', to: t ? `$${t.to[0]} / $${t.to[1]}` : '',
      expected: 'No proof', label: 'Signature mismatch' },
    { key: 'replay', icon: 'refresh', name: 'Submit the same claim again', run: runReplay, cta: 'Run replay', running: 'Sending to verifier…',
      desc: 'Sends the accepted proof a second time, unchanged.', k: 'claim tag', from: `${short(nul, 6, 4)} (new)`, to: `${short(nul, 6, 4)} (already used)`,
      expected: 'Rejected' },
    { key: 'redirect', icon: 'wallet', name: 'Redirect the payout', run: runRedirect, cta: 'Run redirection', running: 'Sending to verifier…',
      desc: 'Keeps the valid proof but swaps the recipient after proving.', k: 'payout address', from: shortAddr(S.consent.addr), to: shortAddr(ATTACKER_ADDR),
      expected: 'Rejected' },
  ];
};

function verdict(a, res) {
  if (a.key === 'tamper') {
    const mismatch = res.reason === 'statement_does_not_match_signature';
    return { title: mismatch ? 'Signature mismatch' : 'No proof possible', why: `${explain(res.reason)} This attempt stopped on your device; nothing was sent.`,
      observed: mismatch ? 'No proof · root mismatch' : `No proof · ${res.reason}` };
  }
  return { title: REASON_SHORT[res.reason] ?? 'Rejected', why: explain(res.reason), observed: `Rejected · ${REASON_SHORT[res.reason] ?? res.reason}` };
}

function labBody() {
  const attacks = ATTACKS();
  const rejected = attacks.filter((a) => S.lab[a.key].st === 'rejected').length;
  const accepted = attacks.filter((a) => S.lab[a.key].st === 'accepted').length;
  const score = h('div.vx-glass.lab-score', { role: 'status', 'aria-live': 'polite', 'data-testid': 'lab-score' },
    h('div.lab-score__mark', watchMark(mark('intro'))),
    h('div', h('div.text-figure.vx-num', `${rejected} of ${attacks.length}`), h('div.text-body-sm.vx-muted', accepted ? `attacks rejected · ${accepted} accepted` : 'attacks rejected')));

  const rows = attacks.map((a) => {
    const st = S.lab[a.key];
    const res = st.result;
    let ctrl;
    if (st.st === 'running') ctrl = h('button.run', { type: 'button', disabled: true, 'aria-busy': 'true' }, h('span.vb-spinner', { 'aria-hidden': 'true' }), a.running);
    else if (st.st === 'rejected') ctrl = [tag('ok', 'Rejected, as expected', 'shield-check', { class: 'vx-tag--lg', 'data-testid': `atk-${a.key}-out` }),
      h('button.vx-btn.vx-btn--ghost.run-again', { type: 'button', 'data-testid': `atk-${a.key}`, onclick: a.run }, 'Run again')];
    else if (st.st === 'accepted') ctrl = [tag('bad', 'Accepted — this is a failure', 'x', { class: 'vx-tag--lg', 'data-testid': `atk-${a.key}-out` }),
      h('button.vx-btn.vx-btn--ghost.run-again', { type: 'button', 'data-testid': `atk-${a.key}`, onclick: a.run }, 'Run again')];
    else ctrl = h('button.run', { type: 'button', 'data-testid': `atk-${a.key}`, onclick: a.run }, icon('flask'), a.cta);
    const v = res && st.st === 'rejected' ? verdict(a, res) : null;
    return h('div.exp', { dataset: { st: st.st } },
      h('span.exp__n', icon(st.st === 'rejected' ? 'shield-check' : a.icon)),
      h('div.exp__text', h('h2.text-subheading', a.name), h('p.text-body-sm.vx-muted', a.desc)),
      h('div.vx-tech.diff', { 'aria-label': `${a.k}: ${a.from} changed to ${a.to}` },
        h('span.k', a.k), h('span', h('del', a.from)), h('span', h('ins', a.to))),
      h('div.res', ctrl),
      v ? h('div.why', { role: 'status', 'data-testid': `atk-${a.key}-why` }, icon('check'), h('div', h('div.text-label.why__title', v.title), h('div.text-body-sm', v.why))) : null,
      st.st === 'accepted' ? h('div.why.why--bad', { role: 'alert' }, icon('x'), h('div', h('div.text-label.why__title', 'Accepted — this is a failure'), h('div.text-body-sm', 'The verifier accepted a modified claim. This is a bug.'))) : null);
  });

  const done = attacks.filter((a) => ['rejected', 'accepted'].includes(S.lab[a.key].st));
  const table = done.length
    ? testsTable(done.map((a) => {
      const st = S.lab[a.key];
      const observed = st.st === 'rejected' ? verdict(a, st.result).observed : 'Accepted';
      return { name: a.name, expected: a.expected, observed, pass: st.st === 'rejected' };
    }), { title: 'Verifier log', ranAt: 'Results update as each attempt returns' })
    : h('section.vb-surface.vb-surface--technical.vb-shape--sharp.lab-log-empty', h('div.vb-tests__head', h('div', h('div.text-subheading', 'Verifier log'), h('div.text-body-sm.vb-muted', 'Run an attempt to see the verifier’s answer here.'))));

  return [viewHead(score),
    h('section.vx-content.lab-list', { 'aria-label': 'Attack attempts' }, rows),
    h('div.lab-lower',
      h('div.lab-lower__log', table),
      h('div.vx-content.lab-legend',
        h('span.text-overline.vx-muted', 'If an attack is accepted'),
        msg('error', 'Accepted — this is a failure', 'The verifier paid a modified claim. Shown in error colour with an x and the word “Accepted” so it can’t read as success.', { live: false })))];
}

function settle(key, st, result, name) {
  S.lab[key] = { st, result };
  addHistory({ kind: 'attack', key, name, rejected: st === 'rejected', reason: result?.reason });
  changed('lab');
  renderLab();
}

async function runTamper() {
  S.lab.tamper = { st: 'running', result: null }; renderLab();
  try {
    const r = await call('tamperedProve', { credential: S.statement.issued.credential, blindHex: S.statement.issued.statement.blind, info: S.info });
    settle('tamper', r.rejected ? 'rejected' : 'accepted', r, 'Edited records');
  } catch (e) { settle('tamper', 'rejected', { reason: e.message, edited: [] }, 'Edited records'); }
}

async function postAttack(key, claim, purpose, carries, name) {
  S.lab[key] = { st: 'running', result: null }; renderLab();
  let r;
  try { r = await api('POST', '/api/claims', claim, { purpose, carries }); }
  catch (e) { r = { status: 0, body: { status: 'rejected', reason: e.message } }; }
  const accepted = r.body?.status === 'accepted';
  settle(key, accepted ? 'accepted' : 'rejected', { reason: r.body?.reason ?? r.body?.error, status: r.status }, name);
}

function runReplay() { return postAttack('replay', S.claim, 'Security lab · replay', 'The same claim, resent', 'Replay'); }
function runRedirect() {
  const c = structuredClone(S.claim); c.recipient_address = ATTACKER_ADDR;
  return postAttack('redirect', c, 'Security lab · redirect payout', 'The same proof with a different payout address', 'Redirect payout');
}
