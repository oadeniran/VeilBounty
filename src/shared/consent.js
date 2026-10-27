// Consent receipt: signed by a per-session key generated in the browser BEFORE proving.
// It proves that whoever submitted this claim approved these exact terms. It does not prove real-world identity.
import { signBody, verifyBody, newKeypair } from './signed.js';

export const CONSENT_TYPE = 'veilbounty.consent.v1';

export function createConsentReceipt({ manifestHash, campaignIdHex, disclosure, rootHex, recipientHashHex, nullifierHex, now = Date.now() }) {
  const { secretKeyHex, publicKeyHex } = newKeypair();
  const body = { type: CONSENT_TYPE, manifest_hash: manifestHash, campaign_id: campaignIdHex, disclosure, credential_root: rootHex,
    recipient_hash: recipientHashHex, nullifier: nullifierHex, timestamp_ms: now, consent_pubkey: publicKeyHex };
  return { body, sig: signBody(body, secretKeyHex) };
}

export function checkConsentReceipt(receipt, expected, now = Date.now()) {
  if (!receipt || typeof receipt !== 'object' || !receipt.body || typeof receipt.sig !== 'string') return 'consent_missing';
  const b = receipt.body;
  if (b.type !== CONSENT_TYPE) return 'consent_malformed';
  if (!verifyBody(b, receipt.sig, String(b.consent_pubkey))) return 'consent_bad_signature';
  for (const [field, want] of Object.entries(expected)) if (b[field] !== want) return `consent_mismatch:${field}`;
  if (!Number.isSafeInteger(b.timestamp_ms) || b.timestamp_ms > now + 5 * 60_000 || b.timestamp_ms < now - 24 * 3600_000) return 'consent_stale';
  return null;
}
