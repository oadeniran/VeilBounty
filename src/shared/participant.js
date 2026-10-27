// Participant-side protocol, shared by the browser app and the end-to-end tests.
// Everything here runs on the participant's device. Only `buildClaim`'s output is ever sent to the verifier.
import { parseCsv, canonicalRows, padRows, fieldToHex, hexToField, bytesToField, FIELD_MODULUS, bytesToHex } from './encoding.js';
import { computeRoot, holderCommitment, nullifierFor, recipientHash } from './hash.js';
import { circuitInputs, expectedPublicInputs } from './witness.js';
import { createConsentReceipt } from './consent.js';

export function randomFieldBrowserSafe() {
  const b = new Uint8Array(32); globalThis.crypto.getRandomValues(b);
  return bytesToField(b) % FIELD_MODULUS;
}

export function newHolder(hashApi) {
  const holderSecret = randomFieldBrowserSafe();
  return { holderSecret, holderCommitmentHex: fieldToHex(holderCommitment(hashApi, holderSecret)) };
}

// Local preflight: the statement must reproduce the signed root before anything else happens.
export function loadStatement(hashApi, { csv, blindHex, credential, holderSecret }) {
  const rows = padRows(canonicalRows(parseCsv(csv)));
  const root = computeRoot(hashApi, rows, hexToField(blindHex), holderCommitment(hashApi, holderSecret));
  return { rows, root, matchesCredential: fieldToHex(root) === credential.body.root };
}

// Local-only evaluation, used to tell the participant whether they qualify before they consent.
export function localQualifies(rows, info) {
  const p = info.params;
  const sum = rows.filter((r) => r.category === p.category && r.day >= p.day_from && r.day <= p.day_to).reduce((s, r) => s + r.amount, 0);
  return { qualifies: sum >= p.min_cents && sum <= p.max_cents };
}

export function paramsFromInfo(info) {
  const p = info.params;
  return { campaignId: hexToField(info.campaign_id), category: p.category, dayFrom: p.day_from, dayTo: p.day_to, min: p.min_cents, max: p.max_cents };
}

// Step 1 (before proving): compute public values and sign the consent receipt.
export function prepareConsent(hashApi, { info, credential, holderSecret, recipientAddress, now }) {
  const params = paramsFromInfo(info);
  const rHash = recipientHash(hashApi, recipientAddress);
  const nullifier = nullifierFor(hashApi, holderSecret, params.campaignId);
  const consent = createConsentReceipt({ manifestHash: info.manifest_hash, campaignIdHex: info.campaign_id, disclosure: info.manifest.disclosure,
    rootHex: credential.body.root, recipientHashHex: fieldToHex(rHash), nullifierHex: fieldToHex(nullifier), now });
  return { params, recipientHash: rHash, nullifier, consent };
}

// Step 2: private circuit inputs (never leave the device).
export function privateInputs({ rows, blindHex, holderSecret, credential, prepared }) {
  return circuitInputs({ rows, blind: hexToField(blindHex), holderSecret, root: hexToField(credential.body.root), params: prepared.params,
    recipientHash: prepared.recipientHash, nullifier: prepared.nullifier });
}

// Step 3: the claim. This object is the ONLY thing transmitted to the verifier.
export function buildClaim({ info, credential, proof, prepared, recipientAddress }) {
  return {
    campaign_id: info.campaign_id,
    credential,
    proof: bytesToBase64(proof.proof),
    public_inputs: proof.publicInputs,
    consent: prepared.consent,
    recipient_address: recipientAddress,
  };
}

export function expectedPublic({ credential, prepared }) {
  return expectedPublicInputs({ root: hexToField(credential.body.root), params: prepared.params, recipientHash: prepared.recipientHash, nullifier: prepared.nullifier });
}

function bytesToBase64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(s);
}
export { bytesToHex };
