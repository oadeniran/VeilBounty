// Builds noir_js inputs and the expected public-input vector, in circuit ABI order.
import { fieldToHex, N_ROWS } from './encoding.js';

export const PUBLIC_INPUT_ORDER = ['root', 'campaign_id', 'category', 'day_from', 'day_to', 'min_cents', 'max_cents', 'recipient_hash', 'nullifier'];

export function circuitInputs({ rows, blind, holderSecret, root, params, recipientHash, nullifier }) {
  if (rows.length !== N_ROWS) throw new Error('rows must be padded');
  return {
    amounts: rows.map((r) => String(r.amount)),
    categories: rows.map((r) => String(r.category)),
    days: rows.map((r) => String(r.day)),
    blind: fieldToHex(blind),
    holder_secret: fieldToHex(holderSecret),
    root: fieldToHex(root),
    campaign_id: fieldToHex(params.campaignId),
    category: String(params.category),
    day_from: String(params.dayFrom),
    day_to: String(params.dayTo),
    min_cents: String(params.min),
    max_cents: String(params.max),
    recipient_hash: fieldToHex(recipientHash),
    nullifier: fieldToHex(nullifier),
  };
}

// The public inputs as the verifier expects them (32-byte hex each), derived only from public data.
export function expectedPublicInputs({ root, params, recipientHash, nullifier }) {
  return [root, params.campaignId, BigInt(params.category), BigInt(params.dayFrom), BigInt(params.dayTo), BigInt(params.min), BigInt(params.max), recipientHash, nullifier].map(fieldToHex);
}
