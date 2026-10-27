// UI smoke test: every screen and state of the demo, in a real browser against the real server and issuer,
// with ONLY the proof generation and the verifier's claim replies mocked. It needs no CRS and runs in seconds.
// It does not test cryptography or privacy: `npm run test:browser` does that with real proofs.
// Run: npm run test:ui
import { chromium } from '@playwright/test';
import { once } from 'node:events';
import { createApp } from '../src/server/app.js';

const deadline = setTimeout(() => { console.error('FAIL: deadline exceeded'); process.exit(3); }, 150_000); deadline.unref();
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

const { server } = await createApp({ dbPath: ':memory:', log: () => {} });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// Replace only the worker's "prove" (and "init", which loads the CRS). Everything else runs for real in the worker.
const mockProver = ({ fail = null } = {}) => `(() => {
  const Real = window.Worker;
  window.Worker = class extends Real {
    postMessage(msg) {
      const reply = (data, t) => setTimeout(() => this.onmessage && this.onmessage({ data }), t);
      if (msg && msg.op === 'init') return reply({ id: msg.id, ok: true, result: { ms: 1, threads: 1 } }, 5);
      if (msg && msg.op === 'prove') {
        reply({ type: 'phase', phase: 'witness' }, 50); reply({ type: 'phase', phase: 'prove' }, 300); reply({ type: 'phase', phase: 'package' }, 600);
        if (${JSON.stringify(fail)}) return reply({ id: msg.id, ok: false, error: ${JSON.stringify(fail)} }, 700);
        const a = msg.args;
        return reply({ id: msg.id, ok: true, result: { proofBytes: 14656, timing: { witnessMs: 300, proveMs: 900 }, claim: {
          campaign_id: a.info.campaign_id, credential: a.credential, proof: 'QUJD', public_inputs: Array.from({ length: 9 }, () => '0x' + '0'.repeat(64)),
          consent: { body: {}, sig: '' }, recipient_address: a.recipientAddress } } }, 800);
      }
      super.postMessage(msg);
    }
  };
})();`;

async function session({ width = 1280, height = 900, prover = {}, verifier = 'accept', adapter = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(mockProver(prover));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Refused to|Content Security Policy/i.test(m.text())) errors.push('CSP: ' + m.text()); });
  let first = null, polls = 0;
  await page.route('**/api/claims', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (verifier === 'reject') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ status: 'rejected', reason: 'proof_invalid' }) });
    if (!first) {
      first = body;
      const payout = adapter === 'manual' ? { adapter: { name: 'manual', real: true }, status: 'queued', txid: null } : { adapter: { name: 'simulated', real: false }, status: 'simulated', txid: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'accepted', claim_id: '3f2a9c1e-7b44-4d2a-9a51-0c6d2e8f1b77', payout }) });
    }
    const reason = body.recipient_address !== first.recipient_address ? 'recipient_mismatch' : 'already_claimed';
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ status: 'rejected', reason }) });
  });
  if (adapter === 'manual') {
    await page.route('**/api/campaign', async (route) => { const r = await route.fetch(); const j = await r.json(); j.payout_adapter = { name: 'manual', real: true, label: 'manual' }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
    await page.route('**/api/claims/*/payout', (route) => { polls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: polls > 1 ? 'operator_reported' : 'queued', txid: polls > 1 ? 'ab'.repeat(32) : null }) }); });
  }
  const T = (id) => `[data-testid="${id}"]`;
  const text = async (id) => (await page.locator(T(id)).first().textContent()) ?? '';
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  return { page, ctx, errors, T, text, noHScroll };
}

async function toConsent(s) {
  await s.page.goto(base + '/demo');
  await s.page.click(s.T('start'));
  await s.page.click(s.T('get-statement'));
  await s.page.waitForSelector(s.T('sig-status'), { timeout: 20_000 });
  await s.page.click(s.T('to-consent'));
}

try {
  // 1. Happy path, desktop.
  {
    const s = await session();
    await s.page.goto(base + '/');
    check('homepage renders the live campaign question', /\$200 and \$500 on groceries/.test(await s.page.textContent('#hp-camp-t')));
    await s.page.goto(base + '/demo');
    await s.page.waitForSelector(s.T('start'));
    check('campaign question comes from the manifest', /\$200–\$500 on groceries in September/.test(await s.page.textContent('h1')));
    check('stepper shows six steps', (await s.page.locator('.vb-stepper .vb-step').count()) === 6);
    await s.page.click(s.T('start'));
    check('statement starts empty', (await s.page.locator(s.T('get-statement')).count()) === 1);
    await s.page.click(s.T('get-statement'));
    await s.page.waitForSelector(s.T('sig-status'));
    check('statement: real issuer signature check passes', /Signature valid/.test(await s.text('sig-status')));
    check('statement: all fixture rows listed', (await s.page.locator('.statement-table tbody tr').count()) === 17);
    check('statement: six rows counted, total computed locally', (await s.page.locator('.statement-table tr[data-counted="true"]').count()) === 6 && (await s.text('local-total')) === '$347.85');
    await s.page.click(s.T('to-consent'));
    check('consent: approve disabled with a visible reason', (await s.page.locator(s.T('approve')).isDisabled()) && /payout address and agree/.test(await s.page.textContent('.approve-why')));
    await s.page.fill(s.T('addr'), 'tmtransparentaddressxxxxxxxxxxxxxxxxxxxx'); await s.page.locator(s.T('addr')).blur();
    check('consent: transparent address refused', /Transparent addresses would make the payout public/.test(await s.page.textContent('.addr-desc')));
    await s.page.click(s.T('use-demo-address'));
    check('consent: demo address recognised', /recognised/.test(await s.page.textContent('.addr-desc')));
    await s.page.click(s.T('consent-check'));
    check('consent: approve enabled once both are done', !(await s.page.locator(s.T('approve')).isDisabled()));
    await s.page.click(s.T('approve'));
    await s.page.waitForFunction(() => document.querySelector('[data-testid="local-chip"]')?.textContent.includes('Proving'), null, { timeout: 5000 }).catch(() => {});
    await s.page.waitForFunction(() => /Proof ready/.test(document.querySelector('[data-testid="proof-heading"]')?.textContent ?? ''), null, { timeout: 15_000 });
    check('proof: ready state shows size and measured network note', /14,656 bytes/.test(await s.text('proof-size')) && /bytes sent|no network/i.test(await s.text('prove-net')));
    check('proof: every operation done', (await s.page.locator('.proof-ops .vb-status-row[data-state="done"]').count()) === 4);
    await s.page.click(s.T('to-verify'));
    check('verify: package lists five items', (await s.page.locator('.pkg-card .vb-status-row').count()) === 5);
    await s.page.click(s.T('tech-toggle'));
    check('verify: advanced details expand', (await s.page.getAttribute(s.T('tech-toggle'), 'aria-expanded')) === 'true');
    await s.page.click(s.T('submit'));
    await s.page.waitForSelector(s.T('reward-heading'));
    check('reward: simulated payout shown with no transaction id', /no Zcash transaction sent/.test(await s.text('payout-status')) && !(await s.page.textContent('.payout-card')).match(/txid|[0-9a-f]{64}/));
    check('reward: stepper complete', (await s.page.locator('.vb-step[data-status="done"]').count()) === 6);
    await s.page.click(s.T('open-lab'));
    for (const k of ['replay', 'redirect', 'tamper']) { await s.page.click(s.T(`atk-${k}`)); await s.page.waitForSelector(s.T(`atk-${k}-why`), { timeout: 60_000 }); }
    check('lab: replay, redirect and tamper all rejected', /3 of 3/.test(await s.text('lab-score')));
    check('lab: tamper rejected for real in the worker (root mismatch)', /no longer match/.test(await s.text('atk-tamper-why')));
    check('lab: diff shows the edited rows', /\$62\.40 \/ \$28\.95/.test(await s.page.textContent('.exp:first-child .diff')));
    await s.page.click(s.T('nav-history'));
    await s.page.click(s.T('audit-toggle'));
    check('history: claim, statement and lab entries', (await s.page.locator('.vb-activity__row').count()) === 3);
    check('history: audit table lists requests', (await s.page.locator(`${s.T('netlog')} tbody tr`).count()) >= 4);
    check('history: tamper attempt noted as making no request', /made no request/.test(await s.page.textContent('.audit')));
    check('history: leak scan found 0 rows', (await s.text('rows-sent')).trim() === '0');
    await s.page.click(s.T('nav-claim'));
    await s.page.click(s.T('new-claim'));
    check('new claim resets to an empty statement', (await s.page.locator(s.T('get-statement')).count()) === 1);
    check('no page errors or CSP violations (desktop)', s.errors.length === 0, s.errors.join(' | '));
    await s.ctx.close();
  }
  // 2. Proof failure and retry path.
  {
    const s = await session({ prover: { fail: 'witness_failed' } });
    await toConsent(s); await s.page.click(s.T('use-demo-address')); await s.page.click(s.T('consent-check')); await s.page.click(s.T('approve'));
    await s.page.waitForFunction(() => /could not/.test(document.querySelector('[data-testid="proof-heading"]')?.textContent ?? ''), null, { timeout: 15_000 });
    check('proof failure: error state with retry and back', (await s.page.locator(s.T('retry-proof')).count()) === 1 && (await s.page.locator(s.T('back-to-statement')).count()) === 1);
    check('proof failure: stepper marks the proof step failed', (await s.page.locator('.vb-step[data-status="failed"]').count()) === 1);
    await s.ctx.close();
  }
  // 3. Verifier rejection path.
  {
    const s = await session({ verifier: 'reject' });
    await toConsent(s); await s.page.click(s.T('use-demo-address')); await s.page.click(s.T('consent-check')); await s.page.click(s.T('approve'));
    await s.page.waitForSelector(s.T('to-verify'), { timeout: 15_000 }); await s.page.click(s.T('to-verify')); await s.page.click(s.T('submit'));
    await s.page.waitForSelector(s.T('claim-rejected'));
    check('verifier rejection: reason shown, nothing paid', /did not verify/.test(await s.text('claim-rejected')) && /Nothing was paid/.test(await s.text('claim-rejected')));
    await s.ctx.close();
  }
  // 4. Manual payout path: queued, then operator-reported (never "confirmed").
  {
    const s = await session({ adapter: 'manual' });
    await toConsent(s); await s.page.click(s.T('use-demo-address')); await s.page.click(s.T('consent-check')); await s.page.click(s.T('approve'));
    await s.page.waitForSelector(s.T('to-verify'), { timeout: 15_000 }); await s.page.click(s.T('to-verify')); await s.page.click(s.T('submit'));
    await s.page.waitForSelector(s.T('reward-heading'));
    check('manual payout: waiting for the operator', /Waiting for the operator/.test(await s.text('payout-status')));
    await s.page.waitForFunction(() => /Operator reports/.test(document.querySelector('[data-testid="payout-status"]')?.textContent ?? ''), null, { timeout: 15_000 });
    const card = await s.page.textContent('.payout-card');
    check('manual payout: operator-reported, not confirmed', /not verified it on-chain/.test(await s.text('payout-status')) && /not confirmed by this app/.test(card) && /Unconfirmed/.test(card) && !/\bConfirmed\b/.test(card));
    await s.ctx.close();
  }
  // 5. Mobile: no horizontal scroll on any stage, segmented step bar, section menu.
  {
    const s = await session({ width: 390, height: 844 });
    await s.page.goto(base + '/');
    check('mobile: homepage has no horizontal scroll', await s.noHScroll());
    await s.page.goto(base + '/demo'); await s.page.waitForSelector(s.T('start'));
    const stages = [];
    stages.push(await s.noHScroll());
    check('mobile: segmented step bar replaces the stepper', await s.page.locator('.mx-prog').isVisible() && !(await s.page.locator('.vb-stepper').isVisible()));
    await s.page.click(s.T('start')); await s.page.click(s.T('get-statement')); await s.page.waitForSelector(s.T('sig-status')); stages.push(await s.noHScroll());
    await s.page.click(s.T('to-consent')); stages.push(await s.noHScroll());
    await s.page.click(s.T('use-demo-address')); await s.page.click(s.T('consent-check')); await s.page.click(s.T('approve'));
    await s.page.waitForSelector(s.T('to-verify'), { timeout: 15_000 }); stages.push(await s.noHScroll());
    await s.page.click(s.T('to-verify')); stages.push(await s.noHScroll());
    await s.page.click(s.T('submit')); await s.page.waitForSelector(s.T('reward-heading')); stages.push(await s.noHScroll());
    check('mobile: no horizontal scroll on any stage', stages.every(Boolean), JSON.stringify(stages));
    await s.page.click('#menu-btn');
    check('mobile: section menu opens', await s.page.locator('#app-menu').isVisible());
    await s.page.click('#app-menu a[href="#lab"]');
    check('mobile: menu navigates to the lab', await s.page.waitForSelector('#view-lab', { state: 'visible', timeout: 3000 }).then(() => true, () => false));
    check('no page errors or CSP violations (mobile)', s.errors.length === 0, s.errors.join(' | '));
    await s.ctx.close();
  }
} catch (e) { check('ui flow completed', false, e.message.split('\n')[0]); }

console.log(results.join('\n'));
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
