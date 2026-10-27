// Campaign manifest -> canonical hash -> circuit public parameters.
import { sha256 } from '@noble/hashes/sha256';
import { canonicalJson, bytes32ToField, bytesToHex, dayIndexFromISO, CATEGORY_BY_NAME, EncodingError } from './encoding.js';

export const MIN_BUCKET_CENTS = 10000; // policy: ranges narrower than $100 are refused (re-identification risk)
const ALLOWED_DISCLOSURES = ['qualifies_only'];

export function validateManifest(m) {
  const need = ['v', 'title', 'buyer', 'issuer_id', 'category', 'period', 'predicate', 'disclosure', 'purpose', 'retention_days', 'reward_zat', 'max_participants', 'expires'];
  for (const k of need) if (m?.[k] === undefined) throw new EncodingError('bad_manifest', `manifest missing ${k}`);
  const category = CATEGORY_BY_NAME[m.category];
  if (!category) throw new EncodingError('bad_manifest', 'unknown or padding category');
  const dayFrom = dayIndexFromISO(m.period.from), dayTo = dayIndexFromISO(m.period.to);
  if (dayFrom > dayTo) throw new EncodingError('bad_manifest', 'empty period');
  const { min_cents: min, max_cents: max } = m.predicate;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max > 2 ** 40 || min > max) throw new EncodingError('bad_manifest', 'bad predicate range');
  if (max - min < MIN_BUCKET_CENTS) throw new EncodingError('bad_manifest', 'range narrower than the minimum bucket width');
  if (!ALLOWED_DISCLOSURES.includes(m.disclosure)) throw new EncodingError('bad_manifest', 'unsupported disclosure');
  return { category, dayFrom, dayTo, min, max, expiresDay: dayIndexFromISO(m.expires) };
}

export function manifestHashBytes(m) { return sha256(new TextEncoder().encode(canonicalJson(m))); }
export function manifestHashHex(m) { return bytesToHex(manifestHashBytes(m)); }

// Everything the circuit needs as campaign public inputs. campaign_id commits to the whole manifest.
export function campaignParams(m) {
  const p = validateManifest(m);
  return { ...p, manifestHash: manifestHashHex(m), campaignId: bytes32ToField(manifestHashBytes(m)) };
}
