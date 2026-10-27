// One-time local setup: issuer signing key (mock issuer), consent-free operator config, and a pinned CRS slice
// served from our own origin so the browser prover never contacts a third-party CDN.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '../src/shared/encoding.js';

const root = new URL('../', import.meta.url);
const dataDir = new URL('.data/', root); mkdirSync(dataDir, { recursive: true });
const crsDir = new URL('web/public/crs/', root); mkdirSync(crsDir, { recursive: true });

const keyFile = new URL('issuer-key.json', dataDir);
if (!existsSync(keyFile)) {
  const sk = randomBytes(32);
  writeFileSync(keyFile, JSON.stringify({ issuer_id: 'mock-grocer-1', secret_key_hex: bytesToHex(sk), public_key_hex: bytesToHex(ed25519.getPublicKey(sk)) }, null, 1), { mode: 0o600 });
  console.log('generated mock issuer key in .data/issuer-key.json (not committed)');
} else console.log('issuer key exists');
const { public_key_hex } = JSON.parse(readFileSync(keyFile, 'utf8'));
console.log(`issuer public key: ${public_key_hex}\n  pin it with ISSUER_PUBLIC_KEY=${public_key_hex} for the verifier`);

// Barretenberg WASM served from our origin (the npm build inlines it as a data: URL, which our CSP blocks by design).
const bbDir = new URL('web/public/bb/', root); mkdirSync(bbDir, { recursive: true });
const bbPkg = new URL('node_modules/@aztec/bb.js/dest/', root);
writeFileSync(new URL('barretenberg-threads.wasm.gz', bbDir), readFileSync(new URL('node/barretenberg_wasm/barretenberg-threads.wasm.gz', bbPkg)));
const inline = readFileSync(new URL('browser/barretenberg_wasm/fetch_code/browser/barretenberg.js', bbPkg), 'utf8');
const m = inline.match(/data:application\/gzip;base64,([A-Za-z0-9+/=]+)/);
if (!m) throw new Error('could not extract single-threaded barretenberg wasm from bb.js');
writeFileSync(new URL('barretenberg.wasm.gz', bbDir), Buffer.from(m[1], 'base64'));
console.log('barretenberg wasm copied to web/public/bb/');

// CRS: public BN254 setup points. bb.js requires compressed G1 in 4 MiB blocks: 131072 points (circuit needs 8192) + G2.
const CRS = [
  { name: 'g1_compressed.dat', url: 'https://crs.aztec-cdn.foundation/g1_compressed.dat', range: 'bytes=0-4194303', sha256: 'fad8203ae1fd103658d4bb33b2b4cf126a28352b5de4684737cff23cc15fb94b' },
  { name: 'g2.dat', url: 'https://crs.aztec-cdn.foundation/g2.dat', sha256: '01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f' },
];
for (const f of CRS) {
  const dest = new URL(f.name, crsDir);
  if (existsSync(dest) && createHash('sha256').update(readFileSync(dest)).digest('hex') === f.sha256) { console.log(`crs ${f.name} ok`); continue; }
  const res = await fetch(f.url, { headers: f.range ? { Range: f.range } : {} });
  if (!(res.ok || res.status === 206)) throw new Error(`CRS download failed: ${f.url} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== f.sha256) throw new Error(`CRS checksum mismatch for ${f.name}: ${got}`);
  writeFileSync(dest, buf); console.log(`crs ${f.name} downloaded and checksum-verified`);
}
