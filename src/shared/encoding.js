// Canonical encoding shared by issuer, browser prover and verifier.
// Specified in spec/encoding.md. Any change here requires regenerating spec/test-vectors.json.
// Pure JS (BigInt only) so it runs unchanged in Node and the browser.

export const N_ROWS = 64;
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // BN254 Fr
export const DOMAIN = { ROOT: 1n, HOLDER: 2n, NULLIFIER: 3n, RECIPIENT: 4n, CAMPAIGN: 5n };
export const MAX_AMOUNT_CENTS = 0xffffffffn; // u32
export const EPOCH_UTC = Date.UTC(2026, 0, 1); // day index 0 = 2026-01-01 UTC
export const ADDRESS_MAX_BYTES = 31 * 8; // 248 ASCII bytes, 8 field chunks
export const ADDRESS_CHUNKS = 8;

// Category registry. 0 is reserved for padding and can never be targeted.
export const CATEGORIES = Object.freeze({
  1: 'rent', 2: 'transport', 3: 'groceries', 4: 'dining',
  5: 'utilities', 6: 'entertainment', 7: 'health', 8: 'other',
});
export const CATEGORY_BY_NAME = Object.freeze(Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [v, Number(k)])));
export const MAX_CATEGORY = 8;

export class EncodingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- dates ----
export function dayIndexFromISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new EncodingError('bad_date', `invalid date "${iso}"`);
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) throw new EncodingError('bad_date', `invalid date "${iso}"`);
  const day = Math.round((t - EPOCH_UTC) / 86400000);
  // Day 0 is reserved for padding rows, so real records must fall after 2026-01-01.
  if (day < 1 || day > 0xffffffff) throw new EncodingError('bad_date', `date "${iso}" outside supported range (after 2026-01-01)`);
  return day;
}
export function isoFromDayIndex(day) {
  return new Date(EPOCH_UTC + day * 86400000).toISOString().slice(0, 10);
}
export function todayDayIndex(now = Date.now()) {
  return Math.floor((now - EPOCH_UTC) / 86400000);
}

// ---- amounts ----
export function centsFromString(s) {
  if (typeof s !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(s.trim())) throw new EncodingError('bad_amount', `invalid amount "${s}" (positive decimal, max 2 places)`);
  const [whole, frac = ''] = s.trim().split('.');
  const cents = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  if (cents <= 0n) throw new EncodingError('bad_amount', 'amount must be positive');
  if (cents > MAX_AMOUNT_CENTS) throw new EncodingError('bad_amount', 'amount too large');
  return Number(cents);
}
export function formatCents(c) { return (Number(c) / 100).toFixed(2); }

// ---- rows ----
// A record is { date: 'YYYY-MM-DD', category: 'groceries', amount: '12.34', merchant? }.
// Canonical order: day asc, category asc, amount asc, then merchant string. Padding appended.
export function rowFromRecord(r, lineNo = 0) {
  const category = CATEGORY_BY_NAME[String(r.category ?? '').trim().toLowerCase()];
  if (!category) throw new EncodingError('bad_category', `line ${lineNo}: unsupported category "${r.category}"`);
  return { amount: centsFromString(String(r.amount)), category, day: dayIndexFromISO(String(r.date).trim()) };
}

export function canonicalRows(records) {
  if (!Array.isArray(records)) throw new EncodingError('bad_rows', 'records must be an array');
  if (records.length === 0) throw new EncodingError('bad_rows', 'no records');
  if (records.length > N_ROWS) throw new EncodingError('too_many_rows', `${records.length} records exceeds the ${N_ROWS}-row limit; nothing was truncated`);
  const rows = records.map((r, i) => rowFromRecord(r, i + 1));
  rows.sort((a, b) => a.day - b.day || a.category - b.category || a.amount - b.amount);
  return rows;
}

export function padRows(rows) {
  if (rows.length > N_ROWS) throw new EncodingError('too_many_rows', `more than ${N_ROWS} rows`);
  const out = rows.map((r) => ({ ...r }));
  while (out.length < N_ROWS) out.push({ amount: 0, category: 0, day: 0 });
  return out;
}

export function validatePaddedRows(rows) {
  if (!Array.isArray(rows) || rows.length !== N_ROWS) throw new EncodingError('bad_rows', `expected exactly ${N_ROWS} rows`);
  for (const [i, r] of rows.entries()) {
    for (const k of ['amount', 'category', 'day']) {
      if (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 0xffffffff) throw new EncodingError('bad_rows', `row ${i}: ${k} out of range`);
    }
    if (r.category > MAX_CATEGORY) throw new EncodingError('bad_rows', `row ${i}: category out of registry`);
    if (r.category === 0 && (r.amount !== 0 || r.day !== 0)) throw new EncodingError('bad_rows', `row ${i}: malformed padding`);
  }
  return rows;
}

export function packRow({ amount, category, day }) {
  return BigInt(amount) + (BigInt(category) << 32n) + (BigInt(day) << 64n);
}

// ---- CSV ----
export function parseCsv(text) {
  if (typeof text !== 'string') throw new EncodingError('bad_csv', 'CSV must be text');
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new EncodingError('bad_csv', 'CSV needs a header and at least one row');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  for (const need of ['date', 'category', 'amount']) if (!header.includes(need)) throw new EncodingError('bad_csv', `CSV header missing "${need}"`);
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== header.length) throw new EncodingError('bad_csv', `line ${i + 2}: expected ${header.length} columns`);
    return Object.fromEntries(header.map((h, j) => [h, cells[j]]));
  });
}
export function toCsv(records) {
  return ['date,category,amount,merchant', ...records.map((r) => [r.date, r.category, r.amount, r.merchant ?? ''].join(','))].join('\n') + '\n';
}

// ---- fields ----
export function toField(x) {
  const v = typeof x === 'bigint' ? x : BigInt(x);
  if (v < 0n || v >= FIELD_MODULUS) throw new EncodingError('bad_field', 'value outside field');
  return v;
}
export function fieldToHex(v) { return '0x' + toField(v).toString(16).padStart(64, '0'); }
export function hexToField(h) {
  if (typeof h !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(h)) throw new EncodingError('bad_field', 'expected 0x-prefixed hex field');
  return toField(BigInt(h));
}
export function fieldToBytes(v) {
  const out = new Uint8Array(32); let x = toField(v);
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
export function bytesToField(b) {
  let x = 0n; for (const byte of b) x = (x << 8n) | BigInt(byte); return x;
}
export function bytesToHex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
export function hexToBytes(h) {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new EncodingError('bad_hex', 'invalid hex');
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
}
// Reduce 32 bytes (e.g. SHA-256 output) into a field element: drop the top 3 bits so it is always < 2^253 < p.
export function bytes32ToField(b) { const c = Uint8Array.from(b); c[0] &= 0x1f; return bytesToField(c); }

// ---- recipient address canonicalisation ----
// Zcash testnet addresses are Bech32/Bech32m (single-case). Canonical form = trimmed, lower-case ASCII.
const ADDRESS_RE = /^(utest1|ztestsapling1|tm|t2)[0-9a-z]+$/;
export function canonicalAddress(addr) {
  if (typeof addr !== 'string') throw new EncodingError('bad_address', 'address must be text');
  const t = addr.trim();
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) throw new EncodingError('bad_address', 'mixed-case address');
  const a = t.toLowerCase();
  if (!ADDRESS_RE.test(a)) throw new EncodingError('bad_address', 'not a Zcash testnet address (expected utest1…, ztestsapling1…, tm…)');
  if (a.length > ADDRESS_MAX_BYTES) throw new EncodingError('bad_address', 'address too long');
  return a;
}
export function isShieldedAddress(a) { return a.startsWith('utest1') || a.startsWith('ztestsapling1'); }
// [DOMAIN.RECIPIENT, byteLength, chunk0..chunk7], each chunk = 31 ASCII bytes big-endian, zero padded.
export function addressHashInputs(addr) {
  const a = canonicalAddress(addr);
  const bytes = new TextEncoder().encode(a);
  const chunks = [];
  for (let i = 0; i < ADDRESS_CHUNKS; i++) {
    const slice = new Uint8Array(31); slice.set(bytes.slice(i * 31, i * 31 + 31));
    chunks.push(bytesToField(slice));
  }
  return [DOMAIN.RECIPIENT, BigInt(bytes.length), ...chunks];
}

// ---- canonical JSON (sorted keys, no whitespace) for signatures and manifest hashes ----
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new EncodingError('bad_json', 'only safe integers allowed in signed JSON');
    if (typeof v === 'bigint') throw new EncodingError('bad_json', 'bigint not allowed; encode as hex string');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
