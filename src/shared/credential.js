// Issuer credential: binds the row-commitment root to issuer identity, credential id, holder commitment and expiry.
import { signBody, verifyBody } from './signed.js';
export const CREDENTIAL_TYPE = 'veilbounty.credential.v1';
const HEX32 = /^0x[0-9a-f]{64}$/;

export function checkCredential(cred, { issuerId, issuerPublicKeyHex, todayDay }) {
  if (!cred || typeof cred !== 'object' || !cred.body || typeof cred.sig !== 'string') return 'credential_malformed';
  const b = cred.body;
  if (b.type !== CREDENTIAL_TYPE || !HEX32.test(b.root ?? '') || !HEX32.test(b.holder_commitment ?? '') || typeof b.credential_id !== 'string'
    || !Number.isSafeInteger(b.expires_day) || !Number.isSafeInteger(b.issued_day) || b.encoding !== 'veilbounty-rows-v1') return 'credential_malformed';
  if (b.issuer_id !== issuerId) return 'issuer_untrusted';
  if (!verifyBody(b, cred.sig, issuerPublicKeyHex)) return 'credential_bad_signature';
  if (b.expires_day < todayDay) return 'credential_expired';
  return null;
}
