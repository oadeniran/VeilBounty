// Gate B: cross-language commitment parity. JS (bb.js Poseidon2) roots must be reproduced by the Noir circuit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getNoir, getHashApi } from '../src/server/zk.js';
import { buildVectors, FIXED } from '../scripts/golden-vectors.js';
import { hexToField, dayIndexFromISO, fieldToHex } from '../src/shared/encoding.js';
import { holderCommitment, nullifierFor } from '../src/shared/hash.js';
import { circuitInputs } from '../src/shared/witness.js';

const saved = JSON.parse(readFileSync(new URL('../spec/test-vectors.json', import.meta.url), 'utf8'));
const params = { campaignId: FIXED.campaignId, category: 3, dayFrom: dayIndexFromISO('2026-09-01'), dayTo: dayIndexFromISO('2026-09-30'), min: 20000, max: 50000 };

function inputsFor(v, root, api) {
  return circuitInputs({ rows: v.rows, blind: hexToField(v.blind), holderSecret: FIXED.holderSecret, root, params,
    recipientHash: hexToField(saved.recipient_hash), nullifier: nullifierFor(api, FIXED.holderSecret, FIXED.campaignId) });
}

test('saved golden vectors are reproducible from source', async () => {
  const fresh = await buildVectors();
  assert.deepEqual(fresh, saved);
});

test('holder commitment and nullifier match values printed by `nargo test`', async () => {
  const api = await getHashApi();
  assert.equal(fieldToHex(holderCommitment(api, 12345n)), '0x25b3409cea33f22fc9d195f9309c2a72823d7c04c0db2a682339d50dd03f48e5');
  assert.equal(fieldToHex(nullifierFor(api, 12345n, 777n)), '0x00021a7843e1c92479a14c8d23a439550072ef96dbb323884a89169c541b7f01');
});

test('all six golden roots are distinct', () => {
  assert.equal(new Set(saved.vectors.map((v) => v.root)).size, 6);
});

for (const v of saved.vectors) {
  test(`Noir recomputes JS root for vector "${v.name}"`, async () => {
    const api = await getHashApi();
    await getNoir().execute(inputsFor(v, hexToField(v.root), api)); // throws on "root mismatch"
  });
}

test('Noir rejects each vector against the valid root unless it is the valid vector', async () => {
  const api = await getHashApi();
  const validRoot = hexToField(saved.vectors[0].root);
  for (const v of saved.vectors.slice(1)) {
    await assert.rejects(getNoir().execute(inputsFor(v, validRoot, api)), /root mismatch/, v.name);
  }
});
