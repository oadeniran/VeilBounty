// Ed25519 signatures over canonical JSON. Used for issuer credentials and consent receipts.
import { ed25519 } from '@noble/curves/ed25519';
import { canonicalJson, bytesToHex, hexToBytes } from './encoding.js';

const enc = (body) => new TextEncoder().encode(canonicalJson(body));
export function signBody(body, secretKeyHex) { return bytesToHex(ed25519.sign(enc(body), hexToBytes(secretKeyHex))); }
export function verifyBody(body, sigHex, publicKeyHex) {
  try {
    if (!/^[0-9a-f]{128}$/.test(sigHex) || !/^[0-9a-f]{64}$/.test(publicKeyHex)) return false;
    return ed25519.verify(hexToBytes(sigHex), enc(body), hexToBytes(publicKeyHex));
  } catch { return false; }
}
export function newKeypair() {
  const sk = ed25519.utils.randomPrivateKey();
  return { secretKeyHex: bytesToHex(sk), publicKeyHex: bytesToHex(ed25519.getPublicKey(sk)) };
}
