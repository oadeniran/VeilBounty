// Local proving boundary. Private inputs (records, blind, holder secret) live here and in the page's memory only.
// Every network request this worker makes is reported to the page (method, path, bytes sent, bytes received)
// so the audit log can show it. The worker posts phase messages while proving so the UI can show real progress.
import { Barretenberg, BarretenbergSync, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuit from '../../circuits/claim/target/claim.json';
import * as P from '../../src/shared/participant.js';
import { fieldToHex, todayDayIndex, formatCents, isoFromDayIndex } from '../../src/shared/encoding.js';
import { checkCredential } from '../../src/shared/credential.js';

const realFetch = self.fetch.bind(self);
self.fetch = async (input, init = {}) => {
  const url = input instanceof Request ? input.url : String(input); // string, URL or Request
  const body = init.body; const sent = body ? (typeof body === 'string' ? body.length : body.byteLength ?? 0) : 0;
  const method = init.method ?? (input instanceof Request ? input.method : 'GET');
  const path = new URL(url, self.location.href).pathname;
  const res = await realFetch(input, init);
  const len = Number(res.headers.get('content-length'));
  self.postMessage({ type: 'net', entry: { method, url: path, bytesSent: sent, status: res.status, received: Number.isFinite(len) && len > 0 ? len : null } });
  return res;
};

// Served from our origin; bb.js appends -threads for the multithreaded build.
const WASM_PATH = new URL('/bb/barretenberg.wasm.gz', self.location.href).href;
let hashApi, backend, initP;
const state = {}; // holderSecret etc. Never posted back except as public values.
const phase = (name) => self.postMessage({ type: 'phase', phase: name });

async function init() {
  const t = performance.now();
  hashApi = await BarretenbergSync.initSingleton({ wasmPath: WASM_PATH });
  const threads = Math.min(navigator.hardwareConcurrency || 1, 4);
  const api = await Barretenberg.new({ threads, skipSrsInit: true, wasmPath: WASM_PATH });
  // Public CRS served from our own origin (scripts/setup.js pins checksums). No third-party CDN is contacted.
  const [g1, g2] = await Promise.all(['/crs/g1_compressed.dat', '/crs/g2.dat'].map(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('prover_files_missing');
    return new Uint8Array(await r.arrayBuffer());
  }));
  await api.srsInitSrs({ pointsBuf: g1, numPoints: g1.length / 32, g2Point: g2 });
  backend = new UltraHonkBackend(circuit.bytecode, api);
  return { ms: Math.round(performance.now() - t), threads };
}

function witnessError(e) {
  const m = String(e?.message ?? e);
  return m.includes('root mismatch') ? 'statement_does_not_match_signature'
    : m.includes('below minimum') || m.includes('above maximum') ? 'does_not_qualify' : 'witness_failed';
}

const handlers = {
  async init() { initP ??= init(); initP.catch(() => { initP = null; }); return initP; },
  async newHolder() {
    // Only the hash API is needed to enrol, so a missing CRS does not block getting the statement.
    hashApi ??= await BarretenbergSync.initSingleton({ wasmPath: WASM_PATH });
    const h = P.newHolder(hashApi); state.holderSecret = h.holderSecret;
    return { holderCommitmentHex: h.holderCommitmentHex };
  },
  // Ed25519 check of the credential against the issuer key the campaign pins, plus expiry and schema.
  async verifyCredential({ credential, issuerId, publicKeyHex }) {
    return { error: checkCredential(credential, { issuerId, issuerPublicKeyHex: publicKeyHex, todayDay: todayDayIndex() }) };
  },
  async loadStatement({ csv, blindHex, credential }) {
    const st = P.loadStatement(hashApi, { csv, blindHex, credential, holderSecret: state.holderSecret });
    state.rows = st.rows;
    return { matchesCredential: st.matchesCredential, rootHex: fieldToHex(st.root) };
  },
  async localCheck({ info }) { return P.localQualifies(state.rows, info); },
  async prepareConsent({ info, credential, recipientAddress }) {
    state.prepared = P.prepareConsent(hashApi, { info, credential, holderSecret: state.holderSecret, recipientAddress });
    const c = state.prepared;
    return { consent: c.consent, nullifierHex: fieldToHex(c.nullifier), recipientHashHex: fieldToHex(c.recipientHash) };
  },
  async prove({ credential, blindHex, info, recipientAddress }) {
    await handlers.init();
    const inputs = P.privateInputs({ rows: state.rows, blindHex, holderSecret: state.holderSecret, credential, prepared: state.prepared });
    const noir = new Noir(circuit);
    phase('witness');
    const t0 = performance.now();
    let witness;
    try { ({ witness } = await noir.execute(inputs)); }
    catch (e) { throw new Error(witnessError(e)); }
    const t1 = performance.now();
    phase('prove');
    const proof = await backend.generateProof(witness);
    const t2 = performance.now();
    phase('package');
    const claim = P.buildClaim({ info, credential, proof, prepared: state.prepared, recipientAddress });
    return { claim, timing: { witnessMs: Math.round(t1 - t0), proveMs: Math.round(t2 - t1) }, proofBytes: proof.proof.length };
  },
  // Security lab: move $10 between the first two counted rows (same total) and try to build a witness against the
  // signed credential. Runs entirely here; no request is made, because no proof can exist.
  async tamperedProve({ credential, blindHex, info }) {
    const p = info.params;
    const rows = state.rows.map((r) => ({ ...r }));
    const idx = rows.map((r, i) => [r, i]).filter(([r]) => r.category === p.category && r.day >= p.day_from && r.day <= p.day_to).map(([, i]) => i);
    if (idx.length < 2) return { rejected: true, reason: 'not_enough_rows', edited: [] };
    const [a, b] = idx;
    const before = [rows[a].amount, rows[b].amount];
    rows[a].amount += 1000; rows[b].amount -= 1000;
    const edited = [a, b].map((i, j) => ({ index: i, date: isoFromDayIndex(rows[i].day), from: formatCents(before[j]), to: formatCents(rows[i].amount) }));
    const inputs = P.privateInputs({ rows, blindHex, holderSecret: state.holderSecret, credential, prepared: state.prepared });
    try { await new Noir(circuit).execute(inputs); return { rejected: false, edited }; }
    catch (e) { return { rejected: true, reason: witnessError(e), edited }; }
  },
};

self.onmessage = async ({ data: { id, op, args } }) => {
  try { self.postMessage({ id, ok: true, result: await handlers[op](args ?? {}) }); }
  catch (e) { self.postMessage({ id, ok: false, error: String(e?.message ?? e) }); }
};
