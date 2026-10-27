// MOCK ISSUER. Stands in for a merchant/bank system that already holds the participant's records.
// Enrollment: the browser sends only a holder commitment; the issuer commits to its own synthetic records
// with a fresh blind and that commitment, signs the credential, and returns the statement (records + blind).
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseCsv, canonicalRows, padRows, toCsv, fieldToHex, hexToField, bytesToField, todayDayIndex, FIELD_MODULUS } from '../shared/encoding.js';
import { computeRoot } from '../shared/hash.js';
import { signBody } from '../shared/signed.js';
import { CREDENTIAL_TYPE } from '../shared/credential.js';
import { getHashApi } from './zk.js';

export function randomField() { return bytesToField(randomBytes(32)) % FIELD_MODULUS; }

export function loadIssuerKey(path = new URL('../../.data/issuer-key.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadIssuerRecords() {
  return parseCsv(readFileSync(new URL('../../fixtures/mock-grocer-records.csv', import.meta.url), 'utf8'));
}

export async function issueCredential({ holderCommitmentHex, key, records = loadIssuerRecords(), validDays = 90, now = Date.now() }) {
  const holderCommit = hexToField(holderCommitmentHex);
  if (holderCommit === 0n) throw Object.assign(new Error('invalid holder commitment'), { code: 'bad_request' });
  const api = await getHashApi();
  const rows = canonicalRows(records);
  const blind = randomField();
  const root = computeRoot(api, padRows(rows), blind, holderCommit);
  const today = todayDayIndex(now);
  const body = { type: CREDENTIAL_TYPE, encoding: 'veilbounty-rows-v1', issuer_id: key.issuer_id, credential_id: randomUUID(),
    root: fieldToHex(root), holder_commitment: fieldToHex(holderCommit), row_count: rows.length, issued_day: today, expires_day: today + validDays };
  return {
    credential: { body, sig: signBody(body, key.secret_key_hex) },
    // The statement is what a real issuer would let the account holder download: their own records + the blind.
    statement: { csv: toCsv(records), blind: fieldToHex(blind) },
  };
}
