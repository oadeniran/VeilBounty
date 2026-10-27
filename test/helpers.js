import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { newKeypair } from '../src/shared/signed.js';
import { getNoir, getBackend, getHashApi } from '../src/server/zk.js';
import * as P from '../src/shared/participant.js';

export const ADDR_A = 'utest1' + 'a'.repeat(100) + 'q2w3e4r5t6';
export const ADDR_B = 'utest1' + 'b'.repeat(100) + 'q2w3e4r5t6';

// Store under test: in-memory SQLite by default. Set TEST_MONGODB_URI to run the same suite against MongoDB
// (each app gets a fresh, uniquely named database that is dropped on close).
export async function startApp(opts = {}) {
  delete process.env.ISSUER_PUBLIC_KEY;
  const kp = newKeypair();
  const logs = [];
  const mongoUri = process.env.TEST_MONGODB_URI;
  const mongoDbName = `vbtest_${randomUUID().slice(0, 8)}`;
  const store = opts.dbPath || !mongoUri ? { dbPath: opts.dbPath ?? ':memory:' } : { mongoUri, mongoDbName };
  const app = await createApp({ ...store, log: (l) => logs.push(l), issuerKey: { issuer_id: 'mock-grocer-1', secret_key_hex: kp.secretKeyHex, public_key_hex: kp.publicKeyHex }, ...opts });
  // Environment for child processes (operator CLI) that must reach the same store.
  const cliEnv = store.mongoUri ? { MONGODB_URI: mongoUri, MONGODB_DB: mongoDbName } : { MONGODB_URI: '', DB_PATH: store.dbPath };
  // In Node, bb.js proves on the main thread, blocking the event loop for several seconds. With the default 5 s
  // keep-alive, the server can close the idle connection just as the test reuses it (ECONNRESET, seen on Windows).
  app.server.keepAliveTimeout = 120_000;
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const close = async () => {
    await new Promise((r) => app.server.close(r));
    if (app.db.kind === 'mongodb') await app.db.dropDatabase();
    await app.db.close();
  };
  return { ...app, base, api, logs, cliEnv, close };
}

export async function prove(inputs) {
  const { witness } = await getNoir().execute(inputs);
  return (await getBackend()).generateProof(witness);
}

// Full participant journey; returns everything a test may want to tamper with.
export async function participantJourney(app, { recipient = ADDR_A, mutateCsv } = {}) {
  const hashApi = await getHashApi();
  const info = (await app.api('GET', '/api/campaign')).body;
  const holder = P.newHolder(hashApi);
  const issued = (await app.api('POST', '/api/issuer/credentials', { holder_commitment: holder.holderCommitmentHex })).body;
  const csv = mutateCsv ? mutateCsv(issued.statement.csv) : issued.statement.csv;
  const st = P.loadStatement(hashApi, { csv, blindHex: issued.statement.blind, credential: issued.credential, holderSecret: holder.holderSecret });
  const prepared = P.prepareConsent(hashApi, { info, credential: issued.credential, holderSecret: holder.holderSecret, recipientAddress: recipient });
  const inputs = P.privateInputs({ rows: st.rows, blindHex: issued.statement.blind, holderSecret: holder.holderSecret, credential: issued.credential, prepared });
  return { hashApi, info, holder, issued, csv, st, prepared, inputs, recipient };
}
