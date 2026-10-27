// Circuit soundness and input validation (Gate B/C). Uses noir_js execution; failures here mean no proof can exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getNoir, getHashApi } from '../src/server/zk.js';
import { FIXED } from '../scripts/golden-vectors.js';
import { hexToField, dayIndexFromISO, parseCsv, canonicalRows, padRows, validatePaddedRows, centsFromString, canonicalAddress, N_ROWS } from '../src/shared/encoding.js';
import { computeRoot, holderCommitment, nullifierFor } from '../src/shared/hash.js';
import { circuitInputs } from '../src/shared/witness.js';
import { validateManifest } from '../src/shared/campaign.js';

const saved = JSON.parse(readFileSync(new URL('../spec/test-vectors.json', import.meta.url), 'utf8'));
const base = { campaignId: FIXED.campaignId, category: 3, dayFrom: dayIndexFromISO('2026-09-01'), dayTo: dayIndexFromISO('2026-09-30'), min: 20000, max: 50000 };
async function run(rows, params = base, { blind = FIXED.blind, holderSecret = FIXED.holderSecret, root, nullifier } = {}) {
  const api = await getHashApi();
  const r = root ?? computeRoot(api, rows, blind, holderCommitment(api, holderSecret));
  return getNoir().execute(circuitInputs({ rows, blind, holderSecret, root: r, params, recipientHash: hexToField(saved.recipient_hash),
    nullifier: nullifier ?? nullifierFor(api, holderSecret, params.campaignId) }));
}
const rows = saved.vectors[0].rows; // September groceries = 347.85

test('valid dataset executes', async () => { await run(rows); });
test('total below minimum is rejected', async () => { await assert.rejects(run(rows, { ...base, min: 34786, max: 60000 }), /below minimum/); });
test('total above maximum is rejected', async () => { await assert.rejects(run(rows, { ...base, min: 10000, max: 34784 }), /above maximum/); });
test('exact boundaries are inclusive', async () => { await run(rows, { ...base, min: 34785, max: 34785 }); });
test('wrong category changes the filtered total (dining Sept = 49.80) and fails', async () => { await assert.rejects(run(rows, { ...base, category: 4 }), /below minimum/); });
test('wrong period changes the filtered total and fails', async () => { await assert.rejects(run(rows, { ...base, dayFrom: dayIndexFromISO('2026-10-01'), dayTo: dayIndexFromISO('2026-10-31') }), /below minimum/); });
test('padding category cannot be targeted', async () => { await assert.rejects(run(rows, { ...base, category: 0, min: 0 }), /padding category/); });
test('category outside registry cannot be targeted', async () => { await assert.rejects(run(rows, { ...base, category: 9 }), /unknown category/); });
test('padding rows carrying value are rejected', async () => {
  const bad = rows.map((r) => ({ ...r })); bad[N_ROWS - 1] = { amount: 50000, category: 0, day: 0 };
  assert.throws(() => validatePaddedRows(bad), (e) => e.code === 'bad_rows'); // JS guard
  await assert.rejects(run(bad, base, { root: 1n }), /padding row with amount/); // circuit guard, independent of JS
});
test('row category outside registry is rejected', async () => {
  const bad = rows.map((r) => ({ ...r })); bad[N_ROWS - 1] = { amount: 1, category: 9, day: 260 };
  await assert.rejects(run(bad, base, { root: 1n }), /row category out of registry/);
});
test('wrong nullifier is rejected', async () => { await assert.rejects(run(rows, base, { nullifier: 5n }), /nullifier mismatch/); });
test('wrong holder secret cannot open the root', async () => {
  const api = await getHashApi();
  const root = computeRoot(api, rows, FIXED.blind, holderCommitment(api, FIXED.holderSecret));
  await assert.rejects(run(rows, base, { holderSecret: FIXED.holderSecret + 1n, root }), /root mismatch/);
});
test('amounts beyond u32 are rejected at witness generation (overflow guard)', async () => {
  const api = await getHashApi();
  const inputs = circuitInputs({ rows, blind: FIXED.blind, holderSecret: FIXED.holderSecret, root: 1n, params: base, recipientHash: hexToField(saved.recipient_hash), nullifier: nullifierFor(api, FIXED.holderSecret, base.campaignId) });
  inputs.amounts[3] = String(2n ** 32n);
  await assert.rejects(getNoir().execute(inputs));
});
test('maximum-value dataset sums without overflow (64 × u32 max fits u64)', async () => {
  const big = Array.from({ length: N_ROWS }, (_, i) => ({ amount: 0xffffffff, category: 3, day: 250 }));
  const total = 64 * 0xffffffff;
  await run(big, { ...base, min: total, max: total });
});

// Encoding / input validation (issuer + browser share this code)
test('oversized datasets are rejected, never truncated', () => {
  const recs = Array.from({ length: 65 }, () => ({ date: '2026-09-01', category: 'groceries', amount: '1.00' }));
  assert.throws(() => canonicalRows(recs), (e) => e.code === 'too_many_rows');
});
test('malformed rows are rejected', () => {
  assert.throws(() => parseCsv('date,category,amount\n2026-09-01,groceries'), (e) => e.code === 'bad_csv');
  assert.throws(() => parseCsv('date,amount\n2026-09-01,1.00'), (e) => e.code === 'bad_csv');
});
test('negative, zero, over-precise and huge amounts are rejected', () => {
  for (const a of ['-1.00', '0', '0.00', '1.234', '99999999999', 'abc']) assert.throws(() => centsFromString(a), (e) => e.code === 'bad_amount', a);
});
test('invalid or out-of-range dates are rejected', () => {
  for (const d of ['2026-02-30', '2026-13-01', '2025-12-31', '2026-01-01', '09/01/2026']) assert.throws(() => dayIndexFromISO(d), (e) => e.code === 'bad_date', d);
});
test('unsupported categories (including the padding slot) are rejected', () => {
  for (const c of ['crypto', '', '0']) assert.throws(() => canonicalRows([{ date: '2026-09-01', category: c, amount: '1.00' }]), (e) => e.code === 'bad_category', c);
});
test('padded row validation rejects malformed padding', () => {
  const p = padRows(canonicalRows([{ date: '2026-09-01', category: 'groceries', amount: '1.00' }]));
  p[10] = { amount: 5, category: 0, day: 0 };
  assert.throws(() => validatePaddedRows(p), (e) => e.code === 'bad_rows');
});
test('address canonicalisation: case-folds single-case, rejects mixed case and non-testnet', () => {
  assert.equal(canonicalAddress('  UTEST1ABC  '), 'utest1abc');
  assert.throws(() => canonicalAddress('utest1AbC'), (e) => e.code === 'bad_address');
  assert.throws(() => canonicalAddress('u1mainnetaddress'), (e) => e.code === 'bad_address');
});
test('campaign policy refuses narrow (re-identifying) ranges and padding category', () => {
  const m = JSON.parse(readFileSync(new URL('../fixtures/campaign.json', import.meta.url), 'utf8'));
  assert.throws(() => validateManifest({ ...m, predicate: { min_cents: 34700, max_cents: 34800 } }), /bucket/);
  assert.throws(() => validateManifest({ ...m, category: 'padding' }), /category/);
});
