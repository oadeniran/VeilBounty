// Campaign verifier. Cheap checks first, then the ZK proof, then an atomic nullifier insert.
// Returns { ok: true, claimId, payout } or { ok: false, reason } with a non-sensitive reason code.
import { randomUUID } from 'node:crypto';
import { fieldToHex, todayDayIndex, EncodingError } from '../shared/encoding.js';
import { recipientHash } from '../shared/hash.js';
import { expectedPublicInputs, PUBLIC_INPUT_ORDER } from '../shared/witness.js';
import { checkCredential } from '../shared/credential.js';
import { checkConsentReceipt } from '../shared/consent.js';

const CLAIM_KEYS = ['campaign_id', 'consent', 'credential', 'proof', 'public_inputs', 'recipient_address'];
const HEX32 = /^0x[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function reject(reason) { return { ok: false, reason }; }

export async function verifyClaim(claim, ctx) {
  const { campaign, params, issuer, db, backend, hashApi, payoutAdapter, now = Date.now() } = ctx;
  // 1. Schema: exact key set, so nothing else (rows, totals, witnesses) can ride along.
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return reject('bad_request');
  const keys = Object.keys(claim).sort();
  if (keys.length !== CLAIM_KEYS.length || keys.some((k, i) => k !== CLAIM_KEYS[i])) return reject('bad_request:fields');
  if (typeof claim.proof !== 'string' || claim.proof.length > 64_000 || !B64.test(claim.proof)) return reject('bad_request:proof');
  if (!Array.isArray(claim.public_inputs) || claim.public_inputs.length !== PUBLIC_INPUT_ORDER.length || !claim.public_inputs.every((x) => typeof x === 'string' && HEX32.test(x))) return reject('bad_request:public_inputs');

  // 2. Campaign context.
  const campaignIdHex = fieldToHex(params.campaignId);
  if (claim.campaign_id !== campaignIdHex) return reject('unknown_campaign');
  const today = todayDayIndex(now);
  if (today > params.expiresDay) return reject('campaign_expired');

  // 3. Credential: pinned issuer key, schema, expiry.
  const credErr = checkCredential(claim.credential, { issuerId: issuer.id, issuerPublicKeyHex: issuer.publicKeyHex, todayDay: today });
  if (credErr) return reject(credErr);
  if (!campaign.issuer_id || claim.credential.body.issuer_id !== campaign.issuer_id) return reject('issuer_not_in_campaign');

  // 4. Recipient binding: recompute from the actual payout address.
  let recHash;
  try { recHash = recipientHash(hashApi, claim.recipient_address); } catch (e) { return reject(e instanceof EncodingError ? e.code : 'bad_address'); }

  // 5. Public inputs must equal what the verifier derives from public data (nullifier is taken from the claim).
  const nullifierHex = claim.public_inputs[8];
  if (nullifierHex === fieldToHex(0n)) return reject('bad_request:nullifier');
  const expected = expectedPublicInputs({ root: BigInt(claim.credential.body.root), params, recipientHash: recHash, nullifier: BigInt(nullifierHex) });
  for (let i = 0; i < expected.length; i++) {
    if (claim.public_inputs[i] !== expected[i]) return reject(PUBLIC_INPUT_ORDER[i] === 'recipient_hash' ? 'recipient_mismatch' : `public_input_mismatch:${PUBLIC_INPUT_ORDER[i]}`);
  }

  // 6. Consent receipt bound to this manifest, credential, recipient and nullifier.
  const consentErr = checkConsentReceipt(claim.consent, {
    manifest_hash: params.manifestHash, campaign_id: campaignIdHex, disclosure: campaign.disclosure,
    credential_root: claim.credential.body.root, recipient_hash: fieldToHex(recHash), nullifier: nullifierHex,
  }, now);
  if (consentErr) return reject(consentErr);

  // 7. Early replay check (cheap); the authoritative check is the UNIQUE insert below.
  if (await db.nullifierUsed(campaignIdHex, nullifierHex)) return reject('already_claimed');

  // 8. Zero-knowledge proof against the verifier-derived public inputs.
  let valid = false;
  try { valid = await backend.verifyProof({ proof: Buffer.from(claim.proof, 'base64'), publicInputs: expected }); } catch { valid = false; }
  if (!valid) return reject('proof_invalid');

  // 9. Atomic acceptance.
  const claimId = randomUUID();
  const err = await db.recordAcceptedClaim({ id: claimId, campaignId: campaignIdHex, nullifier: nullifierHex, maxParticipants: campaign.max_participants,
    payout: { adapter: payoutAdapter.name, amountZat: campaign.reward_zat, address: claim.recipient_address } });
  if (err) return reject(err);

  // 10. Payout via the configured adapter (never blocks acceptance).
  let payout;
  try {
    const r = await payoutAdapter.pay({ claimId, address: claim.recipient_address, amountZat: campaign.reward_zat });
    await db.updatePayout(claimId, { status: r.status, txid: r.txid ?? null, detail: r.detail, clearAddress: !r.keepAddress });
    payout = { adapter: payoutAdapter.describe(), status: r.status, txid: r.txid ?? null, detail: r.detail };
  } catch (e) {
    await db.updatePayout(claimId, { status: 'failed', detail: 'payout adapter error' }).catch(() => {});
    payout = { adapter: payoutAdapter.describe(), status: 'failed', detail: 'payout adapter error' };
  }
  return { ok: true, claimId, payout };
}
