// Foreground browser probe: in-process server + headless Chromium. Hard self-deadline so it never outlives the shell.
import { chromium } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../src/server/app.js';
const LOG = '/tmp/probe.log'; writeFileSync(LOG, '');
const t0 = Date.now(); const log = (...a) => { const l = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${a.join(' ')}`; appendFileSync(LOG, l + '\n'); console.log(l); };
const deadline = Number(process.env.PROBE_DEADLINE_MS ?? 85000);
setTimeout(() => { log('DEADLINE HIT'); process.exit(3); }, deadline).unref();
const { server } = await createApp({ dbPath: ':memory:', log: () => {} });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const b = await chromium.launch(); const p = await b.newPage();
const reqs = [];
p.on('pageerror', (e) => log('PAGEERROR', e.message.slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error' || /Refused/.test(m.text())) log('CONSOLE', m.type(), m.text().slice(0, 200)); });
p.on('request', (r) => reqs.push({ m: r.method(), u: new URL(r.url()).pathname, body: r.postData() ?? '', off: !r.url().startsWith(base) }));
await p.goto(base + '/'); log('loaded');
await p.click('#btn-statement');
await p.waitForFunction(() => document.querySelector('#sig-check').textContent, null, { timeout: 40000 });
log('statement:', await p.locator('#sig-check').textContent());
await p.click('#btn-demo-addr'); await p.click('#btn-consent');
await p.waitForFunction(() => !document.querySelector('#btn-prove').disabled, null, { timeout: 10000 });
const before = reqs.length; log('proving…');
await p.click('#btn-prove');
await p.waitForFunction(() => /Proof ready|can't|no proof|failed/i.test(document.querySelector('#prove-out').textContent), null, { timeout: deadline });
log('prove-out:', await p.locator('#prove-out').textContent());
log('during proving:', JSON.stringify(reqs.slice(before).map((r) => `${r.m} ${r.u} body=${r.body.length}`)));
if (process.env.PROBE_FULL) {
  await p.click('#btn-submit'); await p.waitForFunction(() => document.querySelector('#result').textContent, null, { timeout: 20000 });
  log('result:', await p.locator('#result').textContent());
  await p.screenshot({ path: '/tmp/ui.png', fullPage: true });
}
log('offsite requests:', reqs.filter((r) => r.off).length);
await b.close(); server.close(); process.exit(0);
