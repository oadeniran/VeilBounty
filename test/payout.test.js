// Payout adapters: simulated never invents a txid; manual keeps state honest and the address private.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, prove, participantJourney, ADDR_A } from './helpers.js';
import { ManualPayoutAdapter, SimulatedPayoutAdapter } from '../src/server/payout.js';
import * as P from '../src/shared/participant.js';

test('simulated adapter never returns a transaction id and rejects transparent addresses', async () => {
  const a = new SimulatedPayoutAdapter();
  assert.equal((await a.pay({ address: ADDR_A })).txid, undefined);
  assert.equal((await a.pay({ address: 'tmTransparentAddr123' })).status, 'failed');
});

test('manual adapter: queued -> operator_reported via CLI; address never exposed by the API and deleted after report', async () => {
  // The operator CLI is a separate process, so the store must be shared: a SQLite file, or MongoDB (TEST_MONGODB_URI).
  const dbPath = process.env.TEST_MONGODB_URI ? undefined : join(mkdtempSync(join(tmpdir(), 'vb-')), 'db.sqlite');
  const app = await startApp({ ...(dbPath ? { dbPath } : {}), payoutAdapter: new ManualPayoutAdapter() });
  try {
    const J = await participantJourney(app);
    const c = P.buildClaim({ info: J.info, credential: J.issued.credential, proof: await prove(J.inputs), prepared: J.prepared, recipientAddress: ADDR_A });
    const r = await app.api('POST', '/api/claims', c);
    assert.equal(r.body.payout.status, 'queued');
    const pub = (await app.api('GET', `/api/claims/${r.body.claim_id}/payout`)).body;
    assert.equal(pub.status, 'queued'); assert.ok(!JSON.stringify(pub).includes(ADDR_A));
    const env = { ...process.env, ...app.cliEnv };
    assert.match(execFileSync('node', ['--no-warnings', 'scripts/operator.js', 'list'], { env, encoding: 'utf8' }), new RegExp(r.body.claim_id));
    assert.throws(() => execFileSync('node', ['--no-warnings', 'scripts/operator.js', 'report', r.body.claim_id, 'not-a-txid'], { env, stdio: 'pipe' }));
    execFileSync('node', ['--no-warnings', 'scripts/operator.js', 'report', r.body.claim_id, 'ab'.repeat(32)], { env });
    const after = (await app.api('GET', `/api/claims/${r.body.claim_id}/payout`)).body;
    assert.equal(after.status, 'operator_reported'); assert.equal(after.txid, 'ab'.repeat(32));
    assert.equal(await app.db.payoutAddress(r.body.claim_id), null);
  } finally { await app.close(); }
});
