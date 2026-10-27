// Browser end-to-end + privacy test. Real UI, real in-browser proof, real verifier (in-process, fresh in-memory DB).
// Chromium reports requests from the page AND its workers; every one is recorded and checked.
// Requires the public CRS from `npm run setup`. Exit code 0 = all checks passed. Run: npm run test:browser
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../src/server/app.js';

const deadline = setTimeout(() => { console.error('FAIL: deadline exceeded'); process.exit(3); }, 150_000); deadline.unref();
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

const serverLogs = [];
const { server } = await createApp({ dbPath: ':memory:', log: (l) => serverLogs.push(l) });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); const page = await browser.newPage();
const reqs = []; const errors = [];
page.on('request', (r) => reqs.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));
page.on('pageerror', (e) => errors.push(e.message));
const issuedBlinds = []; // the issuer returns the blind to the participant's browser; it must never travel back out
page.on('response', async (r) => { if (r.url().endsWith('/api/issuer/credentials')) issuedBlinds.push((await r.json()).statement.blind); });
page.on('console', (m) => { if (/Refused to|Content Security Policy/i.test(m.text())) errors.push('CSP: ' + m.text()); });
const T = (id) => `[data-testid="${id}"]`;
const text = async (id) => (await page.locator(T(id)).first().textContent()) ?? '';
const waitText = (id, re, timeout = 40_000) => page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s)?.textContent ?? ''), [T(id), re.source], { timeout });

try {
  // Homepage loads and links to the demo.
  await page.goto(base + '/');
  check('homepage links to the demo', (await page.locator('a[href="/demo"]').count()) > 0);

  await page.goto(base + '/demo');
  await page.click(T('start'));
  await page.click(T('get-statement'));
  await waitText('sig-status', /Signature valid|could not be verified/);
  check('statement signature and row commitment verified locally', /Signature valid/.test(await text('sig-status')), await text('sig-status'));
  check('local qualification shown', /you qualify/.test(await text('local-verdict')));
  await page.click(T('to-consent'));
  check('cannot prove before consent', await page.locator(T('approve')).isDisabled());
  await page.click(T('use-demo-address'));
  check('cannot prove without agreeing to the terms', await page.locator(T('approve')).isDisabled());
  await page.click(T('consent-check'));
  const before = reqs.length; const t = Date.now();
  await page.click(T('approve')); // signs the consent receipt, then proves on this device
  await waitText('proof-heading', /Proof ready|could not/, 90_000);
  const out = await text('proof-heading');
  check('browser generates a real proof', /Proof ready/.test(out), `${out} · ${await text('proof-size')} (wall ${Date.now() - t} ms)`);
  const during = reqs.slice(before);
  check('consent and proving send no request bodies', during.every((r) => r.method === 'GET' && r.body === ''), during.map((r) => `${r.method} ${new URL(r.url).pathname}`).join(', ') || 'no requests');
  check('UI network statement is consistent with observed traffic', /0 bytes sent|no network requests/i.test(await text('prove-net')), await text('prove-net'));
  await page.click(T('to-verify'));
  check('submit only possible after proving', !(await page.locator(T('submit')).isDisabled()));
  await page.click(T('submit'));
  await page.waitForSelector(`${T('reward-heading')}, ${T('claim-rejected')}`, { timeout: 20_000 });
  check('verifier accepts the browser-made claim', (await page.locator(T('reward-heading')).count()) === 1, (await page.locator(T('claim-rejected')).count()) ? await text('claim-rejected') : '');
  check('payout labelled honestly as simulated', /Simulated/.test(await text('payout-status')) && /no Zcash transaction sent/.test(await text('payout-status')));

  // Security lab: three real attempts.
  await page.click(T('nav-lab'));
  await page.click(T('atk-replay')); await page.waitForSelector(T('atk-replay-why'), { timeout: 20_000 });
  check('replay rejected', /already been used/.test(await text('atk-replay-why')), await text('atk-replay-why'));
  await page.click(T('atk-redirect')); await page.waitForSelector(T('atk-redirect-why'), { timeout: 20_000 });
  check('payout redirect rejected', /does not match/.test(await text('atk-redirect-why')), await text('atk-redirect-why'));
  const beforeTamper = reqs.length;
  await page.click(T('atk-tamper')); await page.waitForSelector(T('atk-tamper-why'), { timeout: 60_000 });
  check('sum-preserving record edit cannot be proven', /no longer match/.test(await text('atk-tamper-why')), await text('atk-tamper-why'));
  check('edited-records attempt makes no request', reqs.slice(beforeTamper).filter((r) => r.method !== 'GET').length === 0);
  check('lab shows all three attacks rejected', /3 of 3/.test(await text('lab-score')), await text('lab-score'));

  // History and audit.
  await page.click(T('nav-history'));
  await page.click(T('audit-toggle'));
  check('history records the claim and the lab attempts', (await page.locator(T('hist-claim')).count()) === 1 && /3 attempts/.test(await text('hist-lab')));
  const netRows = await page.locator(`${T('netlog')} tbody tr`).allTextContents();
  check('audit log shows no undefined paths', netRows.length > 0 && netRows.every((r) => !r.includes('undefined')), `${netRows.length} rows`);
  check('UI leak scan: 0 statement rows in any outgoing request', (await text('rows-sent')).trim() === '0');
  check('header chip reports 0 B of records sent', /0 B/.test(await text('local-chip')), await text('local-chip'));
  await page.screenshot({ path: process.env.SCREENSHOT ?? '/tmp/ui-final.png', fullPage: true });

  // ---- privacy over the full request record ----
  const offsite = reqs.filter((r) => !r.url.startsWith(base));
  check('zero third-party requests (no CDN, CRS host, analytics, fonts)', offsite.length === 0, offsite.map((r) => r.url).join(', '));
  const posts = reqs.filter((r) => r.method !== 'GET');
  check('only issuer enrollment and claim submissions are POSTed', JSON.stringify(posts.map((r) => new URL(r.url).pathname)) === JSON.stringify(['/api/issuer/credentials', '/api/claims', '/api/claims', '/api/claims']),
    posts.map((r) => new URL(r.url).pathname).join(', '));
  check('enrollment sends only the holder commitment', JSON.stringify(Object.keys(JSON.parse(posts[0].body))) === '["holder_commitment"]');
  check('claims carry exactly the six claim fields', posts.slice(1).every((p) => Object.keys(JSON.parse(p.body)).sort().join() === 'campaign_id,consent,credential,proof,public_inputs,recipient_address'));
  const csv = readFileSync(new URL('../fixtures/mock-grocer-records.csv', import.meta.url), 'utf8');
  const privateValues = csv.trim().split('\n').slice(1).flatMap((l) => { const [d, c, a, m] = l.split(','); return [d, a, m]; }).concat(['347.85', '34785', 'groceries']);
  const bodies = reqs.map((r) => r.body).join('\n');
  const leaked = privateValues.filter((v) => bodies.includes(v));
  check('no transaction row value, merchant, date or total appears in any request body', leaked.length === 0, leaked.join(', '));
  check('the issuer blind (private witness) is never sent back', issuedBlinds.length === 1 && !bodies.includes(issuedBlinds[0]) && !bodies.includes(issuedBlinds[0].slice(2)));
  const logsText = serverLogs.join('\n');
  check('server logs contain no addresses or bodies', !logsText.includes('utest1') && !logsText.includes('holder_commitment') && serverLogs.length > 0);
  check('no page errors or CSP violations', errors.length === 0, errors.join(' | '));
} catch (e) { check('flow completed', false, e.message.split('\n')[0]); }

console.log(results.join('\n'));
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
