// The claim flow: six stages of one page (design D1–D6). Stages are states, not routes.
// Every value shown comes from the campaign manifest, the issued statement, the worker or the verifier response.
import { h, s, mount, short, shortAddr, plural, timeLabel, dateTimeLabel, elapsedLabel } from '../lib/dom.js';
import { button, setButtonState, stepper, stepSegments, chip, tag, msg, statusList, techDetails, rewardChip, mark, curve, laneIcon, kv, icon, nextId } from '../lib/components.js';
import { watchMark, bindTilt, setMarkStage } from '../lib/mark.js';
import { S, STEPS, STAGE, changed, addHistory, freshStatement, freshProof, freshLab } from './store.js';
import { api, netlog, registerPrivateValues } from './net.js';
import { call, onPhase } from './prover.js';
import { explain, explainProof, shortDate, longDate, dollars, capital, inPeriod } from './copy.js';
import { parseCsv, canonicalAddress, isShieldedAddress, isoFromDayIndex, centsFromString, formatCents } from '../../../src/shared/encoding.js';

export const DEMO_ADDR = 'utest1demoplaceholder' + 'q'.repeat(60) + 'notarealwalletaddress';
const VERSIONS = { app: __APP_VERSION__, noir: __NOIR_VERSION__, bb: __BB_VERSION__ };

const els = {};
let teardown = [];   // per-render cleanups (tilt listeners, timers)
let live = {};       // element references the current stage updates in place

export function initClaim(root) {
  els.root = root;
  els.steprow = h('div.vx-steprow');
  els.stage = h('div.stage');
  mount(root, els.steprow, els.stage);
  onPhase((phase) => { if (S.proof.status === 'running') { S.proof.phase = phase; updateProofLive(); } });
  renderStage(false);
}

export function goStage(n, focus = true) {
  S.stage = n;
  renderStage(focus);
  changed('stage');
}

export function rerender() { if (S.view === 'claim') renderStage(false); }

function renderStage(focusHeading) {
  for (const fn of teardown) fn();
  teardown = []; live = {};
  const prevTestId = document.activeElement?.closest?.('.stage') ? document.activeElement.dataset.testid : null;
  const hadFocus = els.stage.contains(document.activeElement);
  renderSteprow();
  const fns = [stageCampaign, stageStatement, stageConsent, stageProof, stageVerify, stageReward];
  mount(els.stage, fns[S.stage]());
  els.stage.dataset.stage = STEPS[S.stage].toLowerCase();
  if (focusHeading) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    els.stage.querySelector('[data-stage-heading]')?.focus({ preventScroll: true });
  } else if (hadFocus) {
    // A re-render replaced the focused control: put focus back on its replacement, or on the stage heading.
    const again = prevTestId && els.stage.querySelector(`[data-testid="${prevTestId}"]`);
    (again && !again.disabled ? again : els.stage.querySelector('[data-stage-heading]'))?.focus({ preventScroll: true });
  }
}

function renderSteprow() {
  const failedAt = S.stage === STAGE.proof && S.proof.status === 'failed' ? STAGE.proof : -1;
  const current = S.stage === STAGE.reward && S.submit.status === 'accepted' ? STEPS.length : S.stage;
  mount(els.steprow, stepper(STEPS, current, { failedAt }), stepSegments(STEPS, current, { failedAt }),
    S.stage === STAGE.campaign ? h('span.text-body-sm.vx-muted.steprow__note', 'Demo campaign · synthetic data') : null);
}

function stageHead(n, title, lead, aside) {
  return h('div.stage-head',
    h('div.stage-head__text',
      h('span.text-overline.vx-vtext', `Step ${n + 1} · ${STEPS[n]}`),
      h('h1.text-title', { tabindex: '-1', 'data-stage-heading': '' }, title),
      lead ? h('p.text-body-lg.vx-muted', lead) : null),
    aside ?? null);
}

const flowArrow = () => h('li.lane-arrow', { 'aria-hidden': 'true' },
  s('svg', { class: 'd1-flowarrow', viewBox: '0 0 44 16' }, s('path', { d: 'M2 8 C 14 2, 28 14, 40 8 M34 3l6 5-6 5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' })));

// ---------------------------------------------------------------- 1 · Campaign
function stageCampaign() {
  const w = S.words;
  const mk = watchMark(mark('intro'));
  const hero = h('section.hero', { 'aria-labelledby': 'campaign-q' },
    h('div.hero__copy',
      h('span.text-overline.vx-vtext', `${w.buyer} asks · demo buyer`),
      h('h1.text-display.hero__title', { id: 'campaign-q', tabindex: '-1', 'data-stage-heading': '' }, w.question),
      h('p.text-body-lg.vx-muted.hero__lead', `Answer from your ${w.issuerName} statement without handing it over. Your device makes a proof; the buyer learns only whether you qualify.`),
      h('div.row-wrap', chip('reveals', 'Qualifies: yes or no'), chip('hidden', 'rows, merchants, exact total')),
      h('div.row-wrap.row-wrap--cta.actionbar',
        button('Start campaign', { size: 'lg', iconAfter: 'arrow', testid: 'start', onClick: () => goStage(STAGE.statement) }),
        h('span.text-body-sm.vx-muted', 'About 1 minute · nothing is sent until you approve'))),
    h('div.hero__visual',
      h('div.vx-float.hero__mark', h('div.vx-halo'), mk),
      h('article.vx-glass.vx-organic.campaign-card', { 'aria-labelledby': 'campaign-title' },
        h('div.campaign-card__head',
          h('div', h('span.text-overline.vx-muted', 'Campaign'), h('h2.text-subheading.campaign-card__title', { id: 'campaign-title' }, w.title)),
          rewardChip('You earn', w.reward, { className: 'campaign-card__reward' })),
        kv([
          ['Buyer', [w.buyer, ' ', h('span.vx-muted', '(demo)')]],
          ['Issuer', [w.issuerName, ' ', h('span.vx-muted', '(synthetic statement)')]],
          ['Period', w.period, 'vx-num'],
          ['Purpose', w.purpose],
          ['Retention', `${w.retention}, under the campaign terms`],
          ['Reward', [w.reward, w.rewardNote ? h('span.vx-muted', ` · ${w.rewardNote}`) : null]],
          ['Closes', w.expires, 'vx-num'],
        ]))));
  const t = bindTilt(hero, mk); teardown.push(t);
  return [hero, curve('curve--section'),
    h('section.lanes-section', { 'aria-labelledby': 'campaign-how' },
      h('h2.text-heading', { id: 'campaign-how' }, 'What moves, and where it stops'),
      h('ol.lanes',
        h('li.vx-lane', laneIcon('device'), h('div', h('div.vx-lane__k', 'Stays on your device'), h('div.vx-lane__v', `Every row, merchant and your exact ${w.adj} total`))), flowArrow(),
        h('li.vx-lane', laneIcon('shield-check', 'navy'), h('div', h('div.vx-lane__k', 'Verifier checks'), h('div.vx-lane__v', `A proof that the signed total is inside ${w.range}`))), flowArrow(),
        h('li.vx-lane', laneIcon('eye'), h('div', h('div.vx-lane__k', 'Buyer learns'), h('div.vx-lane__v', 'Qualifies: yes or no'))), flowArrow(),
        h('li.vx-lane', h('span.vx-coin', { 'aria-hidden': 'true' }, icon('coin')), h('div', h('div.vx-lane__k', 'You receive'), h('div.vx-lane__v', `${w.reward} to an address you choose`)))))];
}

// ---------------------------------------------------------------- 2 · Statement
async function getStatement() {
  const w = S.words;
  S.statement = { ...freshStatement(), status: 'loading' };
  S.consent.prepared = null; S.proof = freshProof(); S.claim = null;
  rerender();
  try {
    const { holderCommitmentHex } = await call('newHolder');
    const r = await api('POST', '/api/issuer/credentials', { holder_commitment: holderCommitmentHex },
      { purpose: `Receive ${w.issuerName} statement`, carries: 'A one-way commitment to a key made on this device' });
    if (r.status !== 200 || !r.body?.credential) throw new Error(r.body?.error ?? 'issue_failed');
    const issued = r.body;
    const records = parseCsv(issued.statement.csv);
    // From here on, every outgoing body is scanned for these values before it is sent.
    registerPrivateValues([
      ...records.flatMap((rec, row) => [{ value: rec.date, kind: 'row', row }, { value: rec.amount, kind: 'row', row }, { value: rec.merchant, kind: 'merchant', row }]),
      { value: issued.statement.blind, kind: 'blind' }, { value: issued.statement.blind.slice(2), kind: 'blind' },
    ]);
    const [{ error: sigError }, loaded] = await Promise.all([
      call('verifyCredential', { credential: issued.credential, issuerId: S.info.issuer.id, publicKeyHex: S.info.issuer.public_key }),
      call('loadStatement', { csv: issued.statement.csv, blindHex: issued.statement.blind, credential: issued.credential }),
    ]);
    const { qualifies } = await call('localCheck', { info: S.info });
    const counted = records.map((rec) => rec.category === w.category && inPeriod(rec.date, S.info));
    const total = records.reduce((sum, rec, i) => sum + (counted[i] ? centsFromString(rec.amount) : 0), 0);
    registerPrivateValues([{ value: formatCents(total), kind: 'total' }, { value: String(total), kind: 'total' }]);
    S.statement = { status: !sigError && loaded.matchesCredential ? 'signed' : 'invalid', issued, records, counted, total,
      sigError, rootOk: loaded.matchesCredential, qualifies, expiresDay: issued.credential.body.expires_day, error: null };
  } catch (e) {
    S.statement = { ...freshStatement(), status: 'error', error: e.message };
  }
  changed('statement');
  rerender();
}

function stageStatement() {
  const st = S.statement, w = S.words;
  const n = st.records.length;
  const lead = st.status === 'signed' || st.status === 'invalid'
    ? `Check the synthetic records. Rows marked “Counts” make up the ${w.periodShort} ${w.adj} total the proof will test against ${w.range}.`
    : `${w.issuerName} issues a synthetic, signed statement to this device. The rows stay here; ${w.issuerName} only receives a one-way commitment to a key your browser makes.`;
  const head = stageHead(STAGE.statement, `Your ${w.issuerName} statement, opened on this device`, lead,
    h('div.stage-head__mark', watchMark(mark(st.status === 'signed' ? 'local' : 'intro'))));

  let main;
  if (st.status === 'empty') {
    main = h('div.vx-content.state-card',
      h('span.text-label', 'No statement yet'),
      h('p.text-body-sm.vx-muted', `${w.issuerName} issues a synthetic, signed statement to this device. Nothing about you is sent to get it.`),
      button('Get synthetic statement', { icon: 'file', testid: 'get-statement', onClick: getStatement }));
  } else if (st.status === 'loading') {
    main = h('div.vx-content.state-card', { 'aria-busy': 'true' },
      h('span.text-label', 'Loading'), h('div.skel.skel--90'), h('div.skel.skel--70'), h('div.skel.skel--80'),
      h('span.text-body-sm.vx-muted', { role: 'status' }, `Receiving statement from ${w.issuerName}…`));
  } else if (st.status === 'error') {
    main = h('div.vx-content.state-card',
      msg('error', 'The statement did not arrive', `${explain(st.error)} Nothing was sent except the key commitment.`, { testid: 'statement-error' }),
      button('Try again', { icon: 'refresh', testid: 'get-statement', onClick: getStatement }));
  } else {
    const counted = st.counted.filter(Boolean).length;
    main = [
      h('div.table-head',
        h('h2.text-subheading', { id: 'statement-rows' }, `Transactions · ${plural(n, 'row')}`),
        h('div.row-wrap.row-wrap--tight', tag('in', `Counts toward ${w.periodShort} ${w.category}`, 'check'), tag('out', 'Not counted', 'dash'))),
      statementTable(st),
      h('div.vx-tech.total-box',
        h('span.total-box__label', icon('eye-off'), h('span.text-body-sm', `${capital(w.adj)} total (${plural(counted, 'row')}), local only — never sent to the verifier or buyer`)),
        h('span.text-figure-sm.vx-num', { 'data-testid': 'local-total' }, dollars(st.total))),
      st.status === 'signed'
        ? (st.qualifies
          ? h('p.text-body-sm.local-verdict', { 'data-testid': 'local-verdict' }, icon('check', { size: 'sm' }), `Checked here: you qualify. ${dollars(st.total)} is inside ${w.range}, so a proof is possible.`)
          : msg('warning', "You don't meet this campaign's rule", `Your ${w.periodShort} ${w.adj} total is outside ${w.range}, so no proof can be made. Nothing has been sent.`, { testid: 'local-verdict' }))
        : null,
      h('p.text-body-sm.vx-muted', `Rows are synthetic, issued by ${w.issuerName} for this demo. Expires ${longDate(isoFromDayIndex(st.expiresDay))}.`),
    ];
  }

  const aside = [
    h('div.zone.vx-glass.vx-organic-alt',
      h('div.zone__head', laneIcon('device'), h('span.text-subheading', 'Processed on this device')),
      h('p.text-body-sm.vx-muted', n
        ? `All ${plural(n, 'row')}, merchants, categories and the ${dollars(st.total)} ${w.adj} total. They are read and summed here, then fed to the prover.`
        : 'The rows, merchants, categories and your total are read and summed here, then fed to the prover.'),
      chip('local', 'rows, merchants, total')),
    h('div.zone.vx-content',
      h('div.zone__head', laneIcon('file', 'quiet'), h('span.text-subheading', `${w.issuerName}'s signed credential`)),
      signatureZone(st),
      h('div.vx-tech.key-line', h('span.text-mono-sm.vx-muted', `issuer key · ${S.info.issuer.id} · ed25519 ${short(S.info.issuer.public_key, 8, 6)}`))),
    h('div.zone.vx-content',
      h('div.zone__head', laneIcon('send', 'navy'), h('span.text-subheading', 'Sent to the verifier later')),
      h('p.text-body-sm.vx-muted', `Only after you approve: a proof that the signed ${w.adj} total is between ${w.range.replace('–', ' and ')}. Not the rows${n ? `, not ${dollars(st.total)}` : ', not the total'}.`),
      chip('reveals', 'Qualifies: yes or no')),
  ];

  const actions = st.status === 'signed' || st.status === 'invalid'
    ? h('div.stage-actions.actionbar',
      button('Get statement again', { variant: 'ghost', icon: 'refresh', testid: 'get-statement-again', onClick: getStatement }),
      button('Review consent', { size: 'lg', iconAfter: 'arrow', testid: 'to-consent', disabled: !(st.status === 'signed' && st.qualifies), onClick: () => goStage(STAGE.consent) }))
    : null;

  return [head, h('div.split.split--statement',
    h('section.split__main', { 'aria-labelledby': st.records.length ? 'statement-rows' : null }, main),
    h('aside.split__aside', { 'aria-label': 'Where this information goes' }, aside)), actions];
}

function signatureZone(st) {
  const w = S.words;
  if (st.status === 'signed') return msg('success', 'Signature valid', `Checked on this device against the issuer key this campaign pins. Every row matches what ${w.issuerName} signed.`, { testid: 'sig-status' });
  if (st.status === 'invalid') {
    const why = st.sigError ? explain(st.sigError) : `The rows do not match ${w.issuerName}'s signature.`;
    return msg('error', 'Statement could not be verified', `${why} Get the statement again.`, { testid: 'sig-status' });
  }
  if (st.status === 'loading') return h('p.text-body-sm.vx-muted', { role: 'status' }, 'Checking the signature…');
  return h('p.text-body-sm.vx-muted', `Not issued yet. When it arrives, this device checks ${w.issuerName}'s Ed25519 signature before anything else happens.`);
}

function statementTable(st) {
  const w = S.words;
  const body = st.records.map((rec, i) => {
    const counted = st.counted[i];
    const cat = capital(rec.category);
    const t = counted ? tag('in', `${cat} · counts`, 'check')
      : rec.category === w.category ? tag('out', `${cat} · outside ${w.periodShort}`, 'dash')
        : tag('out', `${cat} · not counted`, 'dash');
    return h('tr', { dataset: { counted: String(counted) } },
      h('td.vx-num.cell-date', shortDate(rec.date)),
      h('td.cell-merchant', rec.merchant || '—'),
      h('td.cell-cat', t),
      h('td.r.vx-num.vx-mono.cell-amt', `$${rec.amount}`));
  });
  return h('div.vx-content.table-card',
    h('table.vx-table.statement-table',
      h('caption.vb-sr', `${w.issuerName} transactions. Counted rows make up the ${w.periodShort} ${w.adj} total.`),
      h('thead', h('tr', h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Merchant'), h('th', { scope: 'col' }, 'Category'), h('th.r', { scope: 'col' }, 'Amount'))),
      h('tbody', body)));
}

// ---------------------------------------------------------------- 3 · Consent
function checkAddress(v) {
  const t = (v ?? '').trim();
  if (!t) return { state: 'idle' };
  if (/^(u1|zs1)/i.test(t)) return { state: 'invalid', message: 'That is a mainnet address. This demo pays on Zcash testnet: use a utest1… or ztestsapling1… address.' };
  let a;
  try { a = canonicalAddress(t); } catch { return { state: 'invalid', message: 'This is not a valid Zcash testnet address.' }; }
  if (!isShieldedAddress(a)) return { state: 'invalid', message: 'Transparent addresses would make the payout public. Use a shielded address.' };
  if (a.length < 40) return { state: 'invalid', message: 'This address is too short to be a shielded testnet address.' };
  return { state: 'valid', value: a };
}

function stageConsent() {
  const w = S.words, c = S.consent, m = S.info.manifest;
  const n = S.statement.records.length;
  const manual = S.info.payout_adapter?.name === 'manual';
  const terms = h('dl.terms');
  for (const [k, v] of [
    ['Purpose', m.purpose],
    ['Requested claim', `Your ${w.adj} spend at ${w.issuerName} from ${w.period} was between ${w.range.replace('–', ' and ')}.`],
    ['Data processed', `Your ${plural(n, 'statement row')} and ${w.issuerName}'s signature, read on this device only.`],
    ['Exact disclosure', [h('strong', 'Qualifies: yes'), ' or ', h('strong', 'no'), '. Nothing else about your purchases.']],
    ['Reward', `${w.reward}${w.rewardNote ? ` (${w.rewardNote})` : ''} to the shielded address you choose.`],
    ['Retention', `The result is kept for ${w.retention} under the campaign terms, with no resale. This is a promise in the terms, not something cryptography enforces.`],
    ['Withdrawal', `You can stop at any point before you submit. After the verifier accepts the claim it cannot be withdrawn, and the result stays for the ${w.retention} retention period.`],
  ]) terms.append(h('dt', k), h('dd', v));

  const left = h('section.vx-glass.vx-organic.consent-frame', { 'aria-labelledby': 'consent-terms' },
    h('div.vx-content.consent-inner',
      h('div.consent-inner__head', h('h2.text-subheading', { id: 'consent-terms' }, `${w.title} · ${w.buyer}`), h('span.text-body-sm.vx-muted', 'Demo buyer')),
      terms,
      h('div.recv-row',
        h('div.recv.recv--buyer', h('span.text-overline.vx-vtext', 'Buyer receives'),
          h('ul', h('li', icon('eye', { size: 'sm' }), 'Qualifies: yes or no'), h('li', icon('eye-off', { size: 'sm' }), 'Not your rows, merchants or total'))),
        h('div.recv.vx-tech', h('span.text-overline.vx-muted', 'Verifier processes'),
          h('ul', h('li', icon('shield-check', { size: 'sm' }), 'The proof and its public inputs'),
            h('li', icon('key', { size: 'sm' }), 'Your signed credential, consent receipt and one-time claim tag'),
            h('li', icon('wallet', { size: 'sm' }), 'The payout address bound to the claim'))))));

  // Address field (design system AddressInput markup).
  const addrId = nextId('addr');
  const input = h('input', { id: addrId, value: c.addr, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', placeholder: 'utest1…', 'aria-describedby': `${addrId}-d`, 'data-testid': 'addr' });
  const stateIco = h('span.vb-addr__state', { 'aria-hidden': 'true' });
  const box = h('div.vb-addr', h('span.vb-addr__pool', icon('shield'), 'Shielded'), input, stateIco);
  const desc = h('span.addr-desc', { id: `${addrId}-d` });
  let touched = !!c.addr;

  const cbId = nextId('consent');
  const cb = h('input', { id: cbId, type: 'checkbox', checked: c.checked, 'data-testid': 'consent-check' });
  const approveRow = h('label.approve', { for: cbId, dataset: { checked: String(c.checked) } }, cb,
    h('span.approve__text', h('span.text-label', 'I agree to these terms for this claim'),
      h('span.text-body-sm.vx-muted', 'Nothing is sent yet. The proof is generated next, on this device, and you submit it in a later step.')));
  const whyId = nextId('why');
  const why = h('p.text-body-sm.vx-muted.approve-why', { id: whyId, role: 'status' });
  const approveBtn = button('Approve and generate proof', { size: 'lg', iconAfter: 'arrow', testid: 'approve', loadingLabel: 'Preparing consent', describedBy: whyId, className: 'approve-btn' });
  const err = h('div.consent-error');

  function update() {
    const a = checkAddress(input.value);
    box.dataset.state = a.state;
    if (a.state === 'invalid' && touched) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    stateIco.replaceChildren(a.state === 'valid' ? icon('check') : a.state === 'invalid' && touched ? icon('x') : '');
    desc.removeAttribute('role');
    if (a.state === 'invalid' && touched) { desc.setAttribute('role', 'alert'); mount(desc, h('span.vb-field-error', icon('x'), a.message)); }
    else if (a.state === 'valid') mount(desc, h('span.vb-field__ok', icon('check'), 'Shielded testnet address recognised'));
    else mount(desc, h('span.vb-field__hint', 'Bound into your claim. The verifier rejects any attempt to pay a different address.'));
    approveRow.dataset.checked = String(cb.checked);
    const ok = a.state === 'valid'; const agreed = cb.checked;
    approveBtn.disabled = !(ok && agreed);
    const reason = ok && agreed ? 'Your browser signs a consent receipt for these exact terms, then starts the proof.'
      : !ok && !agreed ? 'Add a payout address and agree to the terms to continue.'
        : !ok ? 'Add a valid shielded testnet payout address to continue.' : 'Agree to the terms to continue.';
    if (why.textContent !== reason) why.textContent = reason; // only announce real changes
  }
  input.addEventListener('input', () => { c.addr = input.value; update(); });
  input.addEventListener('blur', () => { touched = true; update(); });
  cb.addEventListener('change', () => { c.checked = cb.checked; update(); });

  const demoBtn = button('Use demo address', { variant: 'secondary', size: 'sm', icon: 'wallet', testid: 'use-demo-address', onClick: () => {
    input.value = DEMO_ADDR; c.addr = DEMO_ADDR; touched = true; update();
  } });

  approveBtn.addEventListener('click', async () => {
    const a = checkAddress(input.value);
    if (a.state !== 'valid' || !cb.checked) return;
    setButtonState(approveBtn, 'loading'); approveBtn.disabled = true; err.replaceChildren();
    try {
      c.prepared = await call('prepareConsent', { info: S.info, credential: S.statement.issued.credential, recipientAddress: a.value });
      c.addr = a.value; c.error = null;
    } catch (e) {
      c.error = e.message; setButtonState(approveBtn, 'idle'); update();
      mount(err, msg('error', 'Consent could not be prepared', `${explainProof(e.message)} Nothing was sent.`));
      return;
    }
    goStage(STAGE.proof);
    runProof();
  });

  update();
  const head = h('div.stage-head', h('div.stage-head__text',
    h('span.text-overline.vx-vtext', 'Step 3 · Consent'),
    h('h1.text-title', { tabindex: '-1', 'data-stage-heading': '' }, 'Review the terms, then choose where your reward goes')));
  return [head, h('div.split.split--consent', left,
    h('section.pay-col', { 'aria-labelledby': 'pay-h' },
      rewardChip('Reward', w.reward, { className: 'pay-col__reward' }),
      h('div.vx-content.pay-card',
        h('h2.text-subheading', { id: 'pay-h' }, 'Payout address'),
        h('div.vb-field', h('label.vb-field__label', { for: addrId }, 'Zcash testnet address'), box, desc),
        h('div.row-wrap.row-wrap--tight', demoBtn,
          h('span.text-body-sm.vx-muted', manual
            ? 'Demo placeholder, not a real wallet. In manual payout mode, use a shielded testnet address you control.'
            : 'Demo placeholder, not a real wallet. Payouts in this build are simulated, so nothing is sent to it.'))),
      approveRow,
      h('div.actionbar.actionbar--stack', approveBtn, why),
      err))];
}

// ---------------------------------------------------------------- 4 · Proof
let timer = 0;
function startTimer() { stopTimer(); timer = setInterval(() => { if (live.elapsed) live.elapsed.textContent = `Elapsed ${elapsedLabel(performance.now() - S.proof.startedAt)}`; }, 250); }
function stopTimer() { clearInterval(timer); timer = 0; }

async function runProof() {
  const st = S.statement;
  S.proof = { ...freshProof(), status: 'running', startedAt: performance.now(), netFrom: netlog.length };
  S.claim = null;
  rerender(); startTimer(); changed('proof');
  try {
    const r = await call('prove', { credential: st.issued.credential, blindHex: st.issued.statement.blind, info: S.info, recipientAddress: S.consent.addr });
    S.claim = r.claim;
    const during = netlog.slice(S.proof.netFrom);
    const sentBytes = during.reduce((n, e) => n + e.sent, 0);
    Object.assign(S.proof, { status: 'ready', phase: 'done', ms: r.timing.witnessMs + r.timing.proveMs, wallMs: performance.now() - S.proof.startedAt, bytes: r.proofBytes,
      netNote: during.length === 0 ? 'Measured: no network requests were made while proving.'
        : `Measured: ${plural(during.length, 'request')} while proving, all downloads of public prover files from this site, ${sentBytes} bytes sent. No transaction data left this device.` });
  } catch (e) {
    Object.assign(S.proof, { status: 'failed', error: e.message, wallMs: performance.now() - S.proof.startedAt });
  }
  stopTimer(); changed('proof');
  if (S.stage === STAGE.proof) rerender();
}

const OPS = [
  { phase: 'witness', title: (w) => `Check rows against ${w.issuerName}'s signed commitment`, detail: () => 'All 64 padded rows are re-hashed; one edit breaks the match.' },
  { phase: 'witness', title: (w) => `Sum rows marked ${capital(w.category)}`, detail: (w) => `Only ${w.periodShort} ${w.adj} rows count.` },
  { phase: 'prove', title: () => 'Generate range proof', detail: (w) => `Total is inside ${w.range}.` },
  { phase: 'package', title: () => 'Package proof for review', detail: () => 'Nothing is sent until you submit.' },
];
const PHASE_ORDER = ['witness', 'prove', 'package', 'done'];

function opsItems() {
  const p = S.proof, w = S.words;
  const at = p.status === 'ready' ? 3 : PHASE_ORDER.indexOf(p.phase);
  return OPS.map((o) => {
    const i = PHASE_ORDER.indexOf(o.phase);
    const state = p.status === 'ready' || i < at ? 'done' : i === at ? (p.status === 'failed' ? 'failed' : 'active') : 'pending';
    return { state, title: o.title(w), detail: o.detail(w) };
  });
}

function proofWords() {
  const p = S.proof, w = S.words;
  if (p.status === 'ready') return { heading: 'Proof ready', lead: `Made on this device in ${(p.ms / 1000).toFixed(1)} s. It shows your total is inside ${w.range} and nothing else.`, op: 'Done', rail: 'done', mark: 'verify' };
  if (p.status === 'failed') return { heading: 'Proof could not be generated', lead: explainProof(p.error), op: 'Stopped', rail: 'failed', mark: 'failed' };
  const op = { witness: 'Checking rows against the signed commitment…', prove: 'Generating range proof…', package: 'Packaging proof…' }[p.phase] ?? 'Starting the prover…';
  return { heading: 'Generating your proof', lead: `Your device is turning the signed ${w.adj} rows into a proof that the total sits between ${w.range.replace('–', ' and ')}.`, op, rail: null, mark: 'proving' };
}

function updateProofLive() {
  if (!live.ops) return;
  const pw = proofWords();
  live.op.textContent = pw.op;
  live.ops.replaceWith(live.ops = statusList(opsItems(), 'Proof operations'));
}

function stageProof() {
  const p = S.proof, w = S.words, st = S.statement;
  const pw = proofWords();
  const feedRows = st.records.filter((_, i) => st.counted[i]).slice(0, 5);
  const mk = watchMark(mark(pw.mark));
  const elapsedMs = p.status === 'running' ? performance.now() - p.startedAt : p.wallMs ?? 0;
  live.elapsed = h('span.vx-num', `Elapsed ${elapsedLabel(elapsedMs)}`);
  live.op = h('span', pw.op);
  live.ops = statusList(opsItems(), 'Proof operations');

  const actions = h('div.proof-actions.actionbar');
  if (p.status === 'running') { const b = button('Generate proof', { size: 'lg', loadingLabel: 'Generating proof', testid: 'proving' }); setButtonState(b, 'loading'); b.disabled = true; actions.append(b); }
  else if (p.status === 'ready') actions.append(button('Review claim', { size: 'lg', iconAfter: 'arrow', testid: 'to-verify', onClick: () => goStage(STAGE.verify) }));
  else if (p.status === 'failed') actions.append(
    button('Retry on this device', { size: 'lg', icon: 'refresh', testid: 'retry-proof', onClick: () => runProof() }),
    button('Back to statement', { variant: 'ghost', testid: 'back-to-statement', onClick: () => goStage(STAGE.statement) }));
  else actions.append(button('Generate proof', { size: 'lg', testid: 'start-proof', onClick: () => runProof() }));

  const card = h('section.vx-glass.vx-organic.proof-card', { 'aria-labelledby': 'proof-h' },
    h('span.text-overline.vx-vtext', 'Step 4 · Proof · on this device'),
    h('div.proof-visual',
      h('div.feed', { 'aria-hidden': 'true', dataset: { run: String(p.status === 'running') } },
        feedRows.map((r) => h('span', shortDate(r.date), h('b', capital(r.category))))),
      h('div.proof-mark', h('div.vx-halo'), mk),
      h('div.token.vx-content', { dataset: { show: String(p.status === 'ready') } },
        h('span.text-mono-label.vx-muted', 'Output'), h('span.text-label', 'Zero-knowledge proof'),
        h('span.text-body-sm.vx-muted', { 'data-testid': 'proof-size' }, p.status === 'ready' ? `${p.bytes.toLocaleString('en-US')} bytes · held on this device` : p.status === 'failed' ? 'Not produced' : 'Appears here when complete.'))),
    h('div.proof-status', { role: p.status === 'failed' ? 'alert' : 'status', 'aria-live': 'polite' },
      h('h1.text-heading', { id: 'proof-h', tabindex: '-1', 'data-stage-heading': '', 'data-testid': 'proof-heading' }, pw.heading),
      h('p.text-body-lg.vx-muted.proof-lead', pw.lead)),
    h('div.proof-rail',
      h('div.vx-rail', { dataset: { state: pw.rail }, role: 'progressbar', 'aria-label': 'Proof generation', 'aria-valuetext': pw.heading }, h('span')),
      h('div.proof-rail__meta.text-body-sm.vx-muted', live.op, live.elapsed)),
    p.status === 'failed' ? h('div.proof-fail', msg('error', 'Nothing left this device', `Your records stayed here and nothing was sent. ${p.error === 'does_not_qualify' ? 'Retrying will not change the result.' : 'Try again; if it fails twice, get the statement again.'}`, { live: false })) : null,
    actions);

  return [card, h('div.proof-lower',
    h('section.proof-ops', { 'aria-labelledby': 'proof-ops-h' }, h('h2.text-subheading', { id: 'proof-ops-h' }, 'What the device is doing'), live.ops),
    h('aside.vx-content.privacy-aside', { 'aria-label': 'Privacy while proving' },
      h('span.text-overline.vx-muted', 'Privacy while proving'),
      h('div.vx-lane', laneIcon('device'), h('div.text-body-sm', 'Runs in a Web Worker in this browser tab.')),
      h('div.vx-lane', laneIcon('eye-off'), h('div.text-body-sm', 'No request carries your rows or total during this step.')),
      h('div.vx-lane', laneIcon('lock'), h('div.text-body-sm', 'The proof is held here until you submit it in the next step.')),
      h('p.text-body-sm.prove-net', { 'data-testid': 'prove-net', hidden: !p.netNote }, p.netNote)))];
}

// ---------------------------------------------------------------- 5 · Verify
async function submitClaim(btn, out) {
  S.submit = { status: 'submitting', reason: null, response: null, at: null };
  setButtonState(btn, 'loading'); btn.disabled = true;
  mount(out, msg('info', 'Submitting claim', 'Sending the proof package to the verifier. Your rows are not part of this request.'));
  let r;
  try {
    r = await api('POST', '/api/claims', S.claim, { purpose: 'Submit claim package', carries: 'Proof, public inputs, credential, consent receipt, claim tag, payout address' });
  } catch (e) { r = { status: 0, body: { status: 'rejected', reason: e.message } }; }
  if (r.body?.status === 'accepted') {
    S.submit = { status: 'accepted', reason: null, response: r.body, at: Date.now() };
    S.payout = r.body.payout;
    addHistory({ kind: 'claim', ok: true, claimId: r.body.claim_id, payout: r.body.payout.status, nullifier: S.consent.prepared.nullifierHex });
    goStage(STAGE.reward);
    pollPayout();
  } else {
    const reason = r.body?.reason ?? r.body?.error ?? `http_${r.status}`;
    S.submit = { status: 'rejected', reason, response: r.body, at: Date.now() };
    addHistory({ kind: 'claim', ok: false, reason });
    setButtonState(btn, 'idle'); btn.disabled = reason === 'already_claimed';
    mount(out, msg('error', 'Claim rejected by the verifier', `${explain(reason)} Nothing was paid. Your records stayed on this device.`, { testid: 'claim-rejected' }));
  }
}

function stageVerify() {
  const w = S.words, c = S.consent.prepared, claim = S.claim, p = S.proof;
  const n = S.statement.records.length;
  const pkg = [
    { state: 'verified', icon: 'shield-check', title: 'Zero-knowledge proof', detail: `${p.bytes.toLocaleString('en-US')} bytes, made on this device. Shows the total is in ${w.range}.`, word: 'Ready' },
    { state: 'verified', icon: 'file', title: `${w.issuerName} credential`, detail: 'Signed commitment and expiry, not the rows. Signature checked here; the verifier checks it again.', word: 'Valid' },
    { state: 'verified', icon: 'check', title: 'Consent receipt', detail: `Your approval of these terms, signed ${timeLabel(c.consent.body.timestamp_ms)}.`, word: 'Signed' },
    { state: 'verified', icon: 'key', title: 'One-time claim tag', detail: 'Stops the same statement being paid twice for this campaign.', mono: short(c.nullifierHex, 6, 4), word: 'Unused' },
    { state: 'verified', icon: 'wallet', title: 'Payout address', detail: 'Bound into the proof.', mono: shortAddr(S.consent.addr), word: 'Bound' },
  ];
  const tech = [
    { k: 'Campaign', v: short(S.info.campaign_id, 10, 6), copy: S.info.campaign_id },
    { k: 'Terms hash', v: short(S.info.manifest_hash, 10, 6), copy: S.info.manifest_hash },
    { k: 'Public inputs', v: `${claim.public_inputs.length} values: credential root, campaign, category, period, ${w.range} range, payout-address hash, claim tag`, copy: false },
    { k: 'Proof', v: `UltraHonk · ${p.bytes.toLocaleString('en-US')} bytes`, copy: false },
    { k: 'Claim tag', v: short(c.nullifierHex, 10, 6), copy: c.nullifierHex },
    { k: 'Consent key', v: short(c.consent.body.consent_pubkey, 10, 6), copy: c.consent.body.consent_pubkey },
    { k: 'Prover', v: `Noir ${VERSIONS.noir} · bb.js ${VERSIONS.bb} · Web Worker`, copy: false },
  ];
  const out = h('div.submit-out', { 'data-testid': 'claim-result' });
  const submitBtn = button('Submit claim', { size: 'lg', icon: 'send', loadingLabel: 'Submitting claim', testid: 'submit' });
  submitBtn.addEventListener('click', () => submitClaim(submitBtn, out));
  if (S.submit.status === 'rejected') {
    mount(out, msg('error', 'Claim rejected by the verifier', `${explain(S.submit.reason)} Nothing was paid. Your records stayed on this device.`, { testid: 'claim-rejected' }));
    submitBtn.disabled = S.submit.reason === 'already_claimed';
  }
  const mk = watchMark(mark('verify'));
  return [
    stageHead(STAGE.verify, 'Your claim is ready to submit', `The proof says your ${w.periodShort} ${w.adj} spend at ${w.issuerName} was between ${w.range.replace('–', ' and ')}. It says nothing else.`),
    h('div.split.split--verify',
      h('section.vx-glass.vx-organic.buyer-card', { 'aria-labelledby': 'buyer-h' },
        h('div.buyer-card__head', h('h2.text-overline.vx-muted', { id: 'buyer-h' }, `${w.buyer} will see`), h('div.buyer-card__mark', mk)),
        h('p.answer', 'Qualifies: ', h('span.vx-vtext', 'yes')),
        h('p.text-body.vx-muted', `For “${w.title}”. Kept for ${w.retention} under the campaign terms.`),
        curve(),
        h('span.text-overline.vx-muted', 'Never sent to anyone'),
        h('div.row-wrap.row-wrap--tight', chip('hidden', plural(n, 'statement row')), chip('hidden', 'merchant names'), chip('hidden', 'exact total'))),
      h('section.verify-col', { 'aria-labelledby': 'verifier-h' },
        h('div.vx-content.pkg-card',
          h('h2.text-subheading', { id: 'verifier-h' }, 'Sent to the verifier on submit'),
          h('p.text-body-sm.vx-muted', 'The verifier checks these, then passes only the answer to the buyer.'),
          statusList(pkg, 'Claim package')),
        techDetails('Advanced verification details', tech, { testid: 'tech-toggle' }))),
    h('div.vx-content.submit-bar.actionbar',
      h('span.text-body.vx-muted.submit-bar__note', 'Once accepted, this claim cannot be withdrawn. The claim tag can be used once.'),
      h('div.submit-bar__btns', button('Back', { variant: 'ghost', testid: 'back-to-proof', onClick: () => goStage(STAGE.proof) }), submitBtn)),
    out,
  ];
}

// ---------------------------------------------------------------- 6 · Reward
let pollTimer = 0;
function pollPayout() {
  clearTimeout(pollTimer);
  if (S.payout?.status !== 'queued' || !S.submit.response?.claim_id) return;
  pollTimer = setTimeout(async () => {
    try {
      const r = await api('GET', `/api/claims/${S.submit.response.claim_id}/payout`, undefined, { purpose: 'Check payout status', carries: 'Nothing (claim id in the path)' });
      if (r.status === 200 && r.body) { S.payout = { ...S.payout, status: r.body.status, txid: r.body.txid, detail: r.body.detail }; changed('payout'); if (S.stage === STAGE.reward) rerender(); }
    } catch { /* keep polling */ }
    pollPayout();
  }, 5000);
}

function payoutWords(pay) {
  const w = S.words; const reward = w.reward; const addr = shortAddr(S.consent.addr);
  switch (pay?.status) {
    case 'simulated': return {
      tag: ['info', 'Simulated payout', 'flask'], word: 'simulated',
      msg: msg('info', 'Simulated payout — no Zcash transaction sent', "This build's payout adapter runs in simulation mode. The reward is recorded against your claim, but no TAZ moved.", { testid: 'payout-status' }),
      steps: [
        ['ok', 'flask', 'Payout adapter: simulated', `${reward} recorded for ${addr}.`, ['info', 'Simulated']],
        ['none', 'send', 'Zcash transaction', 'None sent. A transaction ID appears here only after a real payout is reported.', ['out', 'Not sent']],
      ] };
    case 'queued': return {
      tag: ['warn', 'Manual payout', 'clock'], word: 'waiting for operator',
      msg: msg('info', 'Waiting for the operator', 'The operator sends the reward from their own testnet wallet and records the transaction id. This page checks every few seconds.', { testid: 'payout-status' }),
      steps: [
        ['active', 'clock', 'Payout adapter: manual', `${reward} queued for ${addr}.`, ['warn', 'Queued']],
        ['none', 'send', 'Zcash transaction', 'Not reported yet.', ['out', 'Waiting']],
      ] };
    case 'operator_reported': return {
      tag: ['warn', 'Operator-reported', 'send'], word: 'operator-reported',
      msg: msg('warning', 'Operator reports a transaction', 'This app has not verified it on-chain. Check your wallet to confirm the reward arrived.', { testid: 'payout-status' }),
      steps: [
        ['ok', 'check', 'Payout adapter: manual', `${reward} sent by the operator to the address bound in your claim.`, ['ok', 'Reported']],
        ['ok', 'send', 'Zcash transaction', h('span', 'Reported by the operator, not confirmed by this app. ', h('span.vx-mono.txid', pay.txid ?? '')), ['warn', 'Unconfirmed']],
      ] };
    default: return {
      tag: ['bad', 'Payout failed', 'x'], word: 'failed',
      msg: msg('error', 'Payout failed', `${pay?.detail ?? 'The payout adapter reported an error.'} Your claim is still accepted.`, { testid: 'payout-status' }),
      steps: [
        ['none', 'x', 'Payout adapter', pay?.detail ?? 'Error', ['bad', 'Failed']],
        ['none', 'send', 'Zcash transaction', 'None sent.', ['out', 'Not sent']],
      ] };
  }
}

export function startNewClaim() {
  clearTimeout(pollTimer);
  S.statement = freshStatement(); S.consent = { addr: '', checked: false, prepared: null, error: null };
  S.proof = freshProof(); S.claim = null; S.submit = { status: 'idle', reason: null, response: null, at: null }; S.payout = null; S.lab = freshLab();
  location.hash = '#claim';
  goStage(STAGE.statement);
}

function stageReward() {
  const w = S.words, pay = S.payout, res = S.submit.response;
  const pw = payoutWords(pay);
  const mk = watchMark(mark('reward'));
  const tl = h('ol.tl', { 'aria-label': 'Payout steps' },
    h('li', h('span.tl__ico.tl__ico--ok', icon('check', { size: 'sm' })), h('span', h('span.text-label.is-block', 'Claim accepted'), h('span.text-body-sm.vx-muted', 'Proof, credential, consent and claim tag verified.')), tag('ok', 'Done')),
    pw.steps.map(([kind, ic, title, detail, [tk, tt]]) => h('li', h('span.tl__ico', { class: `tl__ico--${kind}` }, icon(ic, { size: 'sm' })),
      h('span', h('span.text-label.is-block', title), h('span.text-body-sm.vx-muted', detail)), tag(tk, tt, tk === 'out' ? null : null))));
  return [
    h('section.reward-hero', { 'aria-labelledby': 'reward-h' },
      h('div.reward-hero__mark', h('div.vx-halo.vx-halo--pulse'), mk),
      h('div.reward-hero__copy', { role: 'status' },
        tag('ok', 'Verified by the verifier', 'shield-check', { class: 'vx-tag--lg' }),
        h('h1.text-display', { id: 'reward-h', tabindex: '-1', 'data-stage-heading': '', 'data-testid': 'reward-heading' }, 'Claim accepted'),
        h('p.text-body-lg.vx-muted.reward-hero__lead', `${w.buyer} receives one answer: `, h('strong.ink', 'Qualifies: yes'), '. Your rows and total never left this device.'),
        h('div.row-wrap', rewardChip('Reward · Zcash testnet', w.reward, { large: true, className: 'vx-reward--wide' }), tag(...pw.tag, { class: 'vx-tag--lg' })))),
    h('div.split.split--reward',
      h('section.vx-glass.vx-organic-alt.payout-card', { 'aria-labelledby': 'payout-h' }, h('h2.text-subheading', { id: 'payout-h' }, 'Payout status'), pw.msg, tl),
      h('section.vx-content.receipt-card', { 'aria-labelledby': 'receipt-h' },
        h('div.receipt-card__head', h('h2.text-subheading', { id: 'receipt-h' }, 'Participation receipt'), h('span.text-body-sm.vx-muted', 'Saved to History')),
        kv([
          ['Campaign', w.title], ['Buyer', `${w.buyer} (demo)`], ['Answer released', 'Qualifies: yes'],
          ['Reward', `${w.reward} · ${pw.word}`, 'vx-num'], ['Retention', `${w.retention} from acceptance`],
          ['Claim tag', short(S.consent.prepared.nullifierHex, 6, 4), 'vx-mono mono-sm'],
          ['Accepted', dateTimeLabel(S.submit.at), 'vx-num'], ['Receipt id', short(res.claim_id, 8, 4), 'vx-mono mono-sm'],
        ]),
        h('div.row-wrap.row-wrap--tight.receipt-card__actions',
          button('Open security lab', { variant: 'secondary', icon: 'flask', testid: 'open-lab', onClick: () => { location.hash = '#lab'; } }),
          button('View history', { variant: 'ghost', iconAfter: 'arrow', testid: 'open-history', onClick: () => { location.hash = '#history'; } }),
          button('Start a new claim', { variant: 'ghost', icon: 'refresh', testid: 'new-claim', onClick: startNewClaim })))),
  ];
}

export { getStatement, runProof };
