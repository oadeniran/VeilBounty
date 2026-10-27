// History and technical privacy audit (design D8). Participation list up front; every network request,
// endpoint and byte count behind "Technical privacy details". Everything here is read from this tab's memory.
import { h, mount, short, plural, bytesLabel, timeLabel } from '../lib/dom.js';
import { icon, tag, chip, activity, nextId } from '../lib/components.js';
import { S } from './store.js';
import { netlog, privateRowsSent } from './net.js';
import { explain, capital } from './copy.js';

const VERSIONS = { app: __APP_VERSION__, noir: __NOIR_VERSION__, bb: __BB_VERSION__ };
let root;
let auditOpen = false;

export function renderHistory(el, { focus = false } = {}) {
  root = el ?? root;
  if (!root || S.view !== 'history') return;
  const had = root.contains(document.activeElement) ? document.activeElement.dataset.testid : null;
  mount(root, body());
  if (focus) root.querySelector('[data-view-heading]')?.focus({ preventScroll: true });
  else if (had) root.querySelector(`[data-testid="${had}"]`)?.focus({ preventScroll: true });
}

function participationItems() {
  const w = S.words; const items = [];
  for (const e of S.history.filter((x) => x.kind === 'claim')) {
    items.push(e.ok
      ? { kind: 'proof', testid: 'hist-claim', title: w.title, sub: `${w.buyer} · Qualifies: yes · kept ${w.retention} · ${timeLabel(e.at)}`, amount: w.reward, word: capital(e.payout?.replace('_', '-') ?? 'accepted'), tone: 'success' }
      : { kind: 'rejected', testid: 'hist-claim', title: w.title, sub: `${explain(e.reason)} · ${timeLabel(e.at)}`, word: 'Rejected', tone: 'error' });
  }
  const st = S.statement;
  if (st.records.length) {
    items.push({ kind: 'credential', testid: 'hist-statement', title: `Statement from ${w.issuerName}`,
      sub: `${plural(st.records.length, 'row')} · signature ${st.status === 'signed' ? 'valid' : 'not valid'} · held in this tab only`, word: 'Local', tone: st.status === 'signed' ? 'success' : 'error' });
  }
  const attacks = S.history.filter((x) => x.kind === 'attack');
  if (attacks.length) {
    const accepted = attacks.filter((a) => !a.rejected).length;
    const names = [...new Set(attacks.map((a) => a.name))].join(', ');
    items.push({ kind: accepted ? 'rejected' : 'lab', testid: 'hist-lab', title: `Security lab · ${plural(attacks.length, 'attempt')}`, sub: names,
      word: accepted ? `${accepted} accepted` : 'All rejected', tone: accepted ? 'error' : 'success' });
  }
  return items;
}

function auditRows() {
  return netlog.map((e) => {
    const sent = e.method !== 'GET';
    const isStatement = e.path === '/api/issuer/credentials';
    const priv = sent
      ? (e.leaks.length ? tag('bad', `${plural(new Set(e.leaks.map((l) => l.row ?? l.kind)).size, 'value')} found`, 'x') : tag('ok', 'None'))
      : tag('ok', 'None');
    const recvTag = isStatement ? tag('info', 'Rows received') : null;
    return h('tr', { dataset: { dir: sent ? 'out' : 'in' } },
      h('td.vx-num', String(e.n)),
      h('td', sent
        ? h('span.dir.dir--out', icon('arrow', { size: 'sm' }), 'Sent')
        : h('span.dir.dir--in', icon('arrow-left', { size: 'sm' }), 'Received')),
      h('td.log__purpose', e.purpose ?? '', e.from !== 'page' ? h('span.log__from', ` · ${e.from}`) : null, h('span.log__carries', e.carries ?? '')),
      h('td.log__ep', `${e.method} ${e.path}`),
      h('td.r.vx-num', sent ? `${e.sent.toLocaleString('en-US')} B` : e.received != null ? bytesLabel(e.received) : '—'),
      h('td', isStatement ? [priv, ' ', recvTag] : priv));
  });
}

function body() {
  const w = S.words;
  const items = participationItems();
  const rowsSent = privateRowsSent();
  const tamperRan = S.history.some((x) => x.kind === 'attack' && x.key === 'tamper');
  const auditId = nextId('audit');
  const toggle = h('button.disc', { type: 'button', 'aria-expanded': String(auditOpen), 'aria-controls': auditId, 'data-testid': 'audit-toggle' },
    h('span.disc__lead', icon('key'), 'Technical privacy details'),
    h('span.disc__meta', h('span.text-body-sm.vx-muted', `${plural(netlog.length, 'request')} · network audit`), icon('chevron', { className: 'chev' })));
  const panel = h('div.audit', { id: auditId, hidden: !auditOpen },
    h('div.audit__table',
      h('table.log', { 'data-testid': 'netlog' },
        h('caption.vb-sr', 'Network requests made by this page and its prover worker'),
        h('thead', h('tr', ['#', 'Direction', 'Purpose', 'Endpoint', 'Bytes', 'Private values'].map((c, i) => h('th', { scope: 'col', class: i === 4 ? 'r' : null }, c)))),
        h('tbody', auditRows()))),
    tamperRan ? h('p.text-body-sm.vx-muted.audit__note', icon('info', { size: 'sm' }), 'The edited-records attempt made no request: it stopped on this device because no proof could be built.') : null,
    h('div.audit__meta',
      h('dl.vx-kv.meta-kv',
        h('dt.text-mono-label', 'Audit method'), h('dd.text-mono-sm', 'fetch wrapper (app/net.js) + worker fetch hook; bodies scanned for statement values'),
        h('dt.text-mono-label', 'Prover'), h('dd.text-mono-sm', `Web Worker · Noir ${VERSIONS.noir} · bb.js ${VERSIONS.bb}`),
        h('dt.text-mono-label', 'Payout adapter'), h('dd.text-mono-sm', `${S.info.payout_adapter?.name ?? '—'}${S.info.payout_adapter?.real ? ' (operator-mediated)' : ' (default)'}`),
        h('dt.text-mono-label', 'Network'), h('dd.text-mono-sm', 'Zcash testnet · TAZ')),
      h('dl.vx-kv.meta-kv',
        h('dt.text-mono-label', 'Issuer'), h('dd.text-mono-sm', `${w.issuerName} · ed25519 ${short(S.info.issuer.public_key, 8, 6)}`),
        h('dt.text-mono-label', 'Campaign'), h('dd.text-mono-sm', short(S.info.campaign_id, 10, 6)),
        h('dt.text-mono-label', 'Claim tag'), h('dd.text-mono-sm', S.consent.prepared ? short(S.consent.prepared.nullifierHex, 6, 4) : '—'),
        h('dt.text-mono-label', 'Build'), h('dd.text-mono-sm', `veilbounty ${VERSIONS.app}`))));
  toggle.addEventListener('click', () => {
    auditOpen = !auditOpen; toggle.setAttribute('aria-expanded', String(auditOpen)); panel.hidden = !auditOpen;
  });

  return [
    h('div.view-head', h('div.view-head__text',
      h('span.text-overline.vx-vtext', 'History'),
      h('h1.text-title', { tabindex: '-1', 'data-view-heading': '' }, 'Your participation, and proof of what left this device'))),
    h('div.split.split--history',
      h('section.vx-content.part-card', { 'aria-labelledby': 'part-h' },
        h('h2.text-subheading', { id: 'part-h' }, 'Participation'),
        items.length ? activity([{ day: 'This session', items }], 'Participation history')
          : h('p.text-body-sm.vx-muted.part-empty', 'Nothing yet. Your statement, claims and security-lab attempts appear here. They are kept in this tab only.')),
      h('section.vx-glass.vx-organic.privacy-card', { 'aria-labelledby': 'sum-h' },
        h('h2.text-overline.vx-muted', { id: 'sum-h' }, 'Privacy summary'),
        h('div.privacy-card__figure', h('span.text-figure-xl.vx-num', { 'data-testid': 'rows-sent' }, String(rowsSent)),
          h('span.text-body-lg', `statement ${rowsSent === 1 ? 'row' : 'rows'} in any outgoing request`)),
        h('p.text-body-sm.vx-muted', `Every request this page made is logged below, and every outgoing body was searched for your statement's dates, amounts, merchants, total and signing blind before it was sent. The claim submission carried a proof, public inputs, credential, consent receipt, claim tag and payout address.`),
        h('div.row-wrap.row-wrap--tight', chip('hidden', 'rows, merchants, $ total'), chip('reveals', S.submit.status === 'accepted' ? 'Qualifies: yes' : 'Qualifies: yes or no')))),
    h('section.vx-tech.audit-card', toggle, panel),
  ];
}
