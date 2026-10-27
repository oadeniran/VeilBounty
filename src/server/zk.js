// Node-side Barretenberg + circuit loading (verifier, issuer, tests).
// The proving/verification CRS is read from web/public/crs/ (downloaded and checksum-pinned by `npm run setup`),
// the same files the browser prover uses, so the server never fetches from a CDN at runtime.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Barretenberg, BarretenbergSync, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';

const CIRCUIT_PATH = fileURLToPath(new URL('../../circuits/claim/target/claim.json', import.meta.url));
const CRS_DIR = new URL('../../web/public/crs/', import.meta.url);
let circuit, hashApi, backendP;

export function loadCircuit() {
  if (!circuit) circuit = JSON.parse(readFileSync(CIRCUIT_PATH, 'utf8'));
  return circuit;
}
export async function getHashApi() {
  if (!hashApi) hashApi = await BarretenbergSync.initSingleton();
  return hashApi;
}
export function getBackend() {
  if (!backendP) backendP = (async () => {
    const g1Path = new URL('g1_compressed.dat', CRS_DIR), g2Path = new URL('g2.dat', CRS_DIR);
    if (!existsSync(g1Path) || !existsSync(g2Path)) throw Object.assign(new Error('CRS missing: run npm run setup'), { code: 'crs_missing' });
    const g1 = new Uint8Array(readFileSync(g1Path)), g2 = new Uint8Array(readFileSync(g2Path));
    const api = await Barretenberg.new({ threads: 1, skipSrsInit: true });
    await api.srsInitSrs({ pointsBuf: g1, numPoints: g1.length / 32, g2Point: g2 });
    return new UltraHonkBackend(loadCircuit().bytecode, api);
  })();
  return backendP;
}
export function getNoir() { return new Noir(loadCircuit()); }
