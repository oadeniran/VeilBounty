// Store contract: SQLite and MongoDB must behave identically for replay protection, capacity and payout state.
// SQLite always runs. MongoDB runs when TEST_MONGODB_URI is set (a throwaway database is created and dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/server/db.js';

const backends = [['sqlite', () => openStore({ dbPath: ':memory:' })]];
if (process.env.TEST_MONGODB_URI) backends.push(['mongodb', () => openStore({ mongoUri: process.env.TEST_MONGODB_URI, mongoDbName: `vbstore_${randomUUID().slice(0, 8)}` })]);
else test('mongodb store contract (skipped: set TEST_MONGODB_URI to run)', { skip: true }, () => {});

const CAMPAIGN = '0x' + 'c'.repeat(64);
const claim = (over = {}) => ({ id: randomUUID(), campaignId: CAMPAIGN, nullifier: '0x' + randomUUID().replace(/-/g, '').padEnd(64, '0'), maxParticipants: 1000,
  payout: { adapter: 'manual', amountZat: 100000, address: 'utest1' + 'a'.repeat(80) }, ...over });

for (const [name, open] of backends) {
  test(`${name}: accepts a claim, then rejects the same nullifier (replay protection)`, async () => {
    const s = await open();
    try {
      const c = claim();
      assert.equal(await s.recordAcceptedClaim(c), null);
      assert.equal(await s.nullifierUsed(CAMPAIGN, c.nullifier), true);
      assert.equal(await s.recordAcceptedClaim({ ...c, id: randomUUID() }), 'already_claimed');
      assert.equal(await s.nullifierUsed('0x' + 'd'.repeat(64), c.nullifier), false, 'nullifiers are scoped per campaign');
      assert.equal(await s.recordAcceptedClaim({ ...c, id: randomUUID(), campaignId: '0x' + 'd'.repeat(64) }), null);
      assert.equal((await s.campaignSummary(CAMPAIGN)).accepted, 1);
    } finally { await s.dropDatabase?.(); await s.close(); }
  });

  test(`${name}: concurrent claims never exceed capacity and a duplicate does not use up a place`, async () => {
    const s = await open();
    try {
      const dup = claim({ maxParticipants: 5 });
      assert.equal(await s.recordAcceptedClaim(dup), null);
      assert.equal(await s.recordAcceptedClaim({ ...dup, id: randomUUID() }), 'already_claimed');
      const results = await Promise.all(Array.from({ length: 12 }, () => s.recordAcceptedClaim(claim({ maxParticipants: 5 }))));
      assert.equal(results.filter((r) => r === null).length, 4, JSON.stringify(results));
      assert.ok(results.filter((r) => r !== null).every((r) => r === 'campaign_full'));
      assert.equal((await s.campaignSummary(CAMPAIGN)).accepted, 5);
    } finally { await s.dropDatabase?.(); await s.close(); }
  });

  test(`${name}: payout state — txid is only set, address is never returned and is removed on report`, async () => {
    const s = await open();
    try {
      const c = claim();
      await s.recordAcceptedClaim(c);
      const p0 = await s.getPayout(c.id);
      assert.equal(p0.status, 'queued'); assert.equal(p0.adapter, 'manual'); assert.equal(p0.amount_zat, 100000); assert.equal(p0.txid, null);
      assert.ok(!JSON.stringify(p0).includes(c.payout.address), 'getPayout must not expose the address');
      assert.deepEqual((await s.queuedPayouts()).map((q) => [q.claim_id, q.address]), [[c.id, c.payout.address]]);
      await s.updatePayout(c.id, { status: 'operator_reported', txid: 'ab'.repeat(32), detail: 'reported', clearAddress: true });
      await s.updatePayout(c.id, { status: 'operator_reported', detail: 'again' }); // no txid: keeps the recorded one
      const p1 = await s.getPayout(c.id);
      assert.equal(p1.status, 'operator_reported'); assert.equal(p1.txid, 'ab'.repeat(32)); assert.equal(p1.detail, 'again');
      assert.equal(await s.payoutAddress(c.id), null);
      assert.deepEqual(await s.queuedPayouts(), []);
      assert.deepEqual((await s.campaignSummary(CAMPAIGN)).payouts, { operator_reported: 1 });
      assert.equal(await s.getPayout(randomUUID()), null);
    } finally { await s.dropDatabase?.(); await s.close(); }
  });
}
