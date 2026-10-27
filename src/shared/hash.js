// Poseidon2 constructions. `api` is a bb.js BarretenbergSync (Node or browser) exposing poseidon2Hash.
// Each construction mirrors circuits/claim/src/main.nr exactly; parity is enforced by test/parity.test.js.
import { DOMAIN, N_ROWS, packRow, fieldToBytes, bytesToField, addressHashInputs, validatePaddedRows } from './encoding.js';

export function poseidon2(api, fields) {
  const res = api.poseidon2Hash({ inputs: fields.map((f) => fieldToBytes(f)) });
  return bytesToField(res.hash);
}
export const holderCommitment = (api, holderSecret) => poseidon2(api, [DOMAIN.HOLDER, holderSecret]);
export const nullifierFor = (api, holderSecret, campaignId) => poseidon2(api, [DOMAIN.NULLIFIER, holderSecret, campaignId]);
export const recipientHash = (api, address) => poseidon2(api, addressHashInputs(address));
export function computeRoot(api, paddedRows, blind, holderCommit) {
  validatePaddedRows(paddedRows);
  if (paddedRows.length !== N_ROWS) throw new Error('rows must be padded');
  return poseidon2(api, [DOMAIN.ROOT, ...paddedRows.map(packRow), blind, holderCommit]);
}
