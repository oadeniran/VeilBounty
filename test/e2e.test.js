// Gate D/E: issuer -> local proof -> verifier, with every required negative case. All proofs are real UltraHonk proofs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { startApp, prove, participantJourney, ADDR_A, ADDR_B } from './helpers.js';
import * as P from '../src/shared/participant.js';
import { fieldToHex } from '../src/shared/encoding.js';
import { signBody } from '../src/shared/signed.js';
import { createConsentReceipt } from '../src/shared/consent.js';

let app, J, proof, claim, accepted;
before(async () => {
  app = await startApp();
  J = await participantJourney(app);
  proof = await prove(J.inputs);
  claim = P.buildClaim({ info: J.info, credential: J.issued.credential, proof, prepared: J.prepared, recipientAddress: ADDR_A });
});
after(() => app.close());
const clone = (x) => structuredClone(x);
const submit = (c) => app.api('POST', '/api/claims', c);

test('issued credential reproduces from the statement (holder enrollment is consistent)', () => {
  assert.equal(J.st.matchesCredential, true);
  assert.equal(J.issued.credential.body.holder_commitment, J.holder.holderCommitmentHex);
});
test('proof public inputs equal the verifier-derivable values', () => {
  assert.deepEqual(proof.publicInputs, P.expectedPublic({ credential: J.issued.credential, prepared: J.prepared }));
});

// ---- rejections that must happen BEFORE the valid claim is accepted (so they are not masked by already_claimed) ----
test('missing consent is rejected', async () => {
  const c = clone(claim); c.consent = null;
  assert.equal((await submit(c)).body.reason, 'consent_missing');
});
test('consent receipt for another manifest is rejected', async () => {
  const c = clone(claim);
  c.consent = createConsentReceipt({ ...J.prepared.consent.body, manifestHash: 'ff'.repeat(32), campaignIdHex: J.info.campaign_id, disclosure: 'qualifies_only',
    rootHex: J.issued.credential.body.root, recipientHashHex: J.prepared.consent.body.recipient_hash, nullifierHex: J.prepared.consent.body.nullifier });
  assert.equal((await submit(c)).body.reason, 'consent_mismatch:manifest_hash');
});
test('consent receipt with a forged signature is rejected', async () => {
  const c = clone(claim); c.consent.body.timestamp_ms += 1;
  assert.equal((await submit(c)).body.reason, 'consent_bad_signature');
});
test('changing the payout address after proving is rejected (recipient binding)', async () => {
  const c = clone(claim); c.recipient_address = ADDR_B;
  assert.equal((await submit(c)).body.reason, 'recipient_mismatch');
});
test('mismatched recipient commitment in public inputs is rejected', async () => {
  const c = clone(claim); c.public_inputs[7] = fieldToHex(12345n);
  assert.equal((await submit(c)).body.reason, 'recipient_mismatch');
});
test('swapping the credential root (frontend substitution) is rejected', async () => {
  const c = clone(claim); c.credential.body.root = fieldToHex(1n);
  assert.equal((await submit(c)).body.reason, 'credential_bad_signature');
});
test('credential signed by an unpinned key is rejected', async () => {
  const c = clone(claim); c.credential.sig = signBody(c.credential.body, '11'.repeat(32));
  assert.equal((await submit(c)).body.reason, 'credential_bad_signature');
});
test('public input for a different category or period is rejected', async () => {
  for (const [i, name] of [[2, 'category'], [3, 'day_from'], [4, 'day_to'], [5, 'min_cents'], [6, 'max_cents']]) {
    const c = clone(claim); c.public_inputs[i] = fieldToHex(BigInt(c.public_inputs[i]) + 1n);
    assert.equal((await submit(c)).body.reason, `public_input_mismatch:${name}`);
  }
});
test('extra fields (e.g. raw CSV) in a claim are rejected outright', async () => {
  const c = clone(claim); c.csv = J.csv;
  assert.equal((await submit(c)).body.reason, 'bad_request:fields');
});
test('invalid proof bytes are rejected and do NOT consume the nullifier', async () => {
  const c = clone(claim); const b = Buffer.from(c.proof, 'base64'); b[100] ^= 0xff; c.proof = b.toString('base64');
  assert.equal((await submit(c)).body.reason, 'proof_invalid');
  assert.equal((await app.api('GET', '/api/buyer/summary')).body.accepted_claims, 0);
});
test('a proof for different public inputs (nullifier swapped) is rejected', async () => {
  const c = clone(claim); c.public_inputs[8] = fieldToHex(999n);
  const r = await submit(c);
  assert.ok(['consent_mismatch:nullifier', 'proof_invalid'].includes(r.body.reason), r.body.reason);
});

// ---- acceptance and replay ----
test('valid qualifying claim is accepted and payout reports the true adapter state', async () => {
  const r = await submit(claim);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'accepted');
  accepted = r.body;
  assert.equal(r.body.payout.status, 'simulated');
  assert.equal(r.body.payout.txid, null);
  assert.equal(r.body.payout.adapter.real, false);
  const pay = (await app.api('GET', `/api/claims/${r.body.claim_id}/payout`)).body;
  assert.equal(pay.status, 'simulated'); assert.equal(pay.txid, null); assert.equal(pay.address, undefined);
});
test('replaying the same claim is rejected', async () => {
  assert.equal((await submit(claim)).body.reason, 'already_claimed');
});
test('replaying with a fresh proof of the same credential (same nullifier) is rejected', async () => {
  const again = await prove(J.inputs);
  const c = P.buildClaim({ info: J.info, credential: J.issued.credential, proof: again, prepared: J.prepared, recipientAddress: ADDR_A });
  assert.notEqual(c.proof, claim.proof);
  assert.equal((await submit(c)).body.reason, 'already_claimed');
});
test('the same holder re-proving with a new recipient still maps to the same nullifier and is rejected', async () => {
  const prepared = P.prepareConsent(J.hashApi, { info: J.info, credential: J.issued.credential, holderSecret: J.holder.holderSecret, recipientAddress: ADDR_B });
  assert.equal(fieldToHex(prepared.nullifier), fieldToHex(J.prepared.nullifier));
  const inputs = P.privateInputs({ rows: J.st.rows, blindHex: J.issued.statement.blind, holderSecret: J.holder.holderSecret, credential: J.issued.credential, prepared });
  const c = P.buildClaim({ info: J.info, credential: J.issued.credential, proof: await prove(inputs), prepared, recipientAddress: ADDR_B });
  assert.equal((await submit(c)).body.reason, 'already_claimed');
});
test('buyer summary shows counts only — no addresses, totals or nullifiers', async () => {
  const s = (await app.api('GET', '/api/buyer/summary')).body;
  assert.equal(s.accepted_claims, 1);
  const text = JSON.stringify(s);
  for (const secret of [ADDR_A, J.prepared.consent.body.nullifier, '347.85', '34785']) assert.ok(!text.includes(secret), secret);
});

// ---- tampering ----
test('a modified row cannot produce a proof (root mismatch)', async () => {
  const T = await participantJourney(app, { mutateCsv: (csv) => csv.replace('2026-09-12,groceries,71.30', '2026-09-12,groceries,171.30') });
  assert.equal(T.st.matchesCredential, false);
  await assert.rejects(prove(T.inputs), /root mismatch/);
});
test('sum-preserving alteration (move $10 between two September grocery rows) still fails', async () => {
  const T = await participantJourney(app, { mutateCsv: (csv) => csv.replace('2026-09-12,groceries,71.30', '2026-09-12,groceries,61.30').replace('2026-09-24,groceries,64.15', '2026-09-24,groceries,74.15') });
  assert.equal(P.localQualifies(T.st.rows, T.info).qualifies, true); // same total, still "qualifies" locally
  await assert.rejects(prove(T.inputs), /root mismatch/);
});
test('a fresh participant with an honest statement is accepted (independent nullifier)', async () => {
  const T = await participantJourney(app, { recipient: ADDR_B });
  const pr = await prove(T.inputs);
  const r = await submit(P.buildClaim({ info: T.info, credential: T.issued.credential, proof: pr, prepared: T.prepared, recipientAddress: ADDR_B }));
  assert.equal(r.body.status, 'accepted', JSON.stringify(r.body));
});

// ---- expiry ----
test('expired credential is rejected (campaign still open, same pinned issuer key)', async () => {
  const { writeFileSync, mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const m = JSON.parse(readFileSync(new URL('../fixtures/campaign.json', import.meta.url), 'utf8'));
  m.expires = '2027-12-31'; // keep the campaign open so only the credential can be stale
  const path = join(mkdtempSync(join(tmpdir(), 'vb-')), 'campaign.json'); writeFileSync(path, JSON.stringify(m));
  let clock = Date.now();
  const app2 = await startApp({ manifestPath: path, now: () => clock });
  try {
    const T = await participantJourney(app2); // credential valid for 90 days from today
    const c = P.buildClaim({ info: T.info, credential: T.issued.credential, proof: await prove(T.inputs), prepared: T.prepared, recipientAddress: ADDR_A });
    clock = Date.now() + 91 * 86400_000;
    c.consent = P.prepareConsent(T.hashApi, { info: T.info, credential: T.issued.credential, holderSecret: T.holder.holderSecret, recipientAddress: ADDR_A, now: clock }).consent;
    assert.equal((await app2.api('POST', '/api/claims', c)).body.reason, 'credential_expired');
    clock = Date.now();
    c.consent = P.prepareConsent(T.hashApi, { info: T.info, credential: T.issued.credential, holderSecret: T.holder.holderSecret, recipientAddress: ADDR_A, now: clock }).consent;
    assert.equal((await app2.api('POST', '/api/claims', c)).body.status, 'accepted'); // control: same claim is fine before expiry
  } finally { await app2.close(); }
});
test('campaign past its expiry rejects claims', async () => {
  const later = await startApp({ now: () => Date.UTC(2026, 11, 1) });
  try {
    const T = await participantJourney(later);
    const c = P.buildClaim({ info: T.info, credential: T.issued.credential, proof: await prove(T.inputs), prepared: T.prepared, recipientAddress: ADDR_A });
    assert.equal((await later.api('POST', '/api/claims', c)).body.reason, 'campaign_expired');
  } finally { await later.close(); }
});

// ---- privacy ----
test('server logs contain no claim bodies, witnesses, totals or addresses', () => {
  const all = app.logs.join('\n');
  assert.ok(app.logs.length > 10);
  for (const s of [ADDR_A, ADDR_B, J.issued.statement.blind, fieldToHex(J.holder.holderSecret), '347.85', '34785', 'groceries', J.prepared.consent.body.nullifier, claim.proof.slice(0, 40)]) {
    assert.ok(!all.includes(s), `log leaked ${s.slice(0, 20)}`);
  }
});
test('no wallet secrets, issuer keys or databases are tracked by git', () => {
  const tracked = execSync('git ls-files', { encoding: 'utf8' });
  assert.ok(!/\.data\//.test(tracked) && !/\.sqlite/.test(tracked) && !/\.env$/m.test(tracked));
  // git grep exits 1 when nothing matches; spawnSync avoids shell-specific "|| true" (absent on Windows cmd).
  const grep = spawnSync('git', ['grep', '-l', '-E', 'secret_key_hex"\\s*:\\s*"[0-9a-f]{64}', '--', '.'], { encoding: 'utf8' });
  assert.ok(grep.status === 0 || grep.status === 1, `git grep failed: ${grep.stderr}`);
  assert.equal(grep.stdout.trim(), '');
});
