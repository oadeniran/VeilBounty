// HTTP server: mock issuer endpoint, campaign verifier API, buyer summary, and the static participant app.
// Logging policy: one line per request (method, route, status, reason code, duration). Bodies are never logged.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignParams } from '../shared/campaign.js';
import { fieldToHex } from '../shared/encoding.js';
import { openStore } from './db.js';
import { verifyClaim } from './verifier.js';
import { issueCredential, loadIssuerKey } from './issuer.js';
import { makePayoutAdapter } from './payout.js';
import { getBackend, getHashApi } from './zk.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BODY = 256 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.dat': 'application/octet-stream', '.woff2': 'font/woff2', '.csv': 'text/csv' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

// Storage: an explicit dbPath (tests, ':memory:') always means SQLite. Otherwise MONGODB_URI selects MongoDB,
// and without it the SQLite file at DB_PATH (default .data/veilbounty.sqlite) is used.
export async function createApp({ dbPath, mongoUri, mongoDbName, log = console.log, payoutAdapter = makePayoutAdapter(), issuerKey, manifestPath = join(ROOT, 'fixtures/campaign.json'), now } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const params = campaignParams(manifest);
  issuerKey ??= loadIssuerKey();
  const pinned = process.env.ISSUER_PUBLIC_KEY ?? issuerKey.public_key_hex;
  const issuer = { id: manifest.issuer_id, publicKeyHex: pinned };
  const db = await openStore(dbPath ? { dbPath }
    : (mongoUri ?? process.env.MONGODB_URI) ? { mongoUri: mongoUri ?? process.env.MONGODB_URI, mongoDbName: mongoDbName ?? process.env.MONGODB_DB }
      : { dbPath: process.env.DB_PATH ?? join(ROOT, '.data/veilbounty.sqlite') });
  const hashApi = await getHashApi();
  // The proof backend needs the public CRS from `npm run setup`. Start it now, but let the server (and the
  // issuer) come up without it; claims are refused with "verifier_unavailable" until it is ready.
  const backendP = getBackend();
  backendP.catch((e) => log(`${new Date().toISOString()} verifier backend unavailable: ${e.code ?? e.message}`));
  const ctx = (backend) => ({ campaign: manifest, params, issuer, db, backend, hashApi, payoutAdapter, now: now?.() });
  const buckets = new Map();
  // Behind a platform router (Heroku sets DYNO) every request arrives from the router, so rate-limit on the client
  // address the router appends to X-Forwarded-For (the last entry; earlier entries are client-supplied and untrusted).
  const trustProxy = process.env.TRUST_PROXY === '1' || !!process.env.DYNO;
  const clientIp = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').at(-1).trim() : req.socket.remoteAddress);
  const limited = (ip) => { const t = Date.now(); const b = (buckets.get(ip) ?? []).filter((x) => t - x < 60_000); b.push(t); buckets.set(ip, b); return b.length > 30; };

  const campaignInfo = {
    manifest, manifest_hash: params.manifestHash, campaign_id: fieldToHex(params.campaignId),
    params: { category: params.category, day_from: params.dayFrom, day_to: params.dayTo, min_cents: params.min, max_cents: params.max },
    issuer: { id: issuer.id, public_key: issuer.publicKeyHex }, payout_adapter: payoutAdapter.describe(),
  };

  async function readJson(req) {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw Object.assign(new Error(), { status: 415, reason: 'json_required' });
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error(), { status: 413, reason: 'too_large' }); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error(), { status: 400, reason: 'bad_json' }); }
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const send = (status, body, reason) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); res.reason = reason; };
    if (p === '/api/health') return send(200, { ok: true });
    if (p === '/api/campaign' && req.method === 'GET') return send(200, campaignInfo);
    if (p === '/api/issuer/credentials' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body?.holder_commitment !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.holder_commitment) || Object.keys(body).length !== 1) return send(400, { error: 'expected { holder_commitment }' }, 'bad_request');
      try { return send(200, await issueCredential({ holderCommitmentHex: body.holder_commitment, key: issuerKey }), 'issued'); }
      catch (e) { return send(400, { error: e.code ?? 'issue_failed' }, e.code ?? 'issue_failed'); }
    }
    if (p === '/api/claims' && req.method === 'POST') {
      if (limited(clientIp(req))) return send(429, { status: 'rejected', reason: 'rate_limited' }, 'rate_limited');
      const claim = await readJson(req);
      let backend;
      try { backend = await backendP; } catch { return send(503, { status: 'rejected', reason: 'verifier_unavailable' }, 'verifier_unavailable'); }
      const r = await verifyClaim(claim, ctx(backend));
      return r.ok ? send(200, { status: 'accepted', claim_id: r.claimId, payout: r.payout }, 'accepted') : send(422, { status: 'rejected', reason: r.reason }, r.reason);
    }
    const m = p.match(/^\/api\/claims\/([0-9a-f-]{36})\/payout$/);
    if (m && req.method === 'GET') {
      const row = await db.getPayout(m[1]);
      return row ? send(200, { ...row, adapter: payoutAdapter.describe() }) : send(404, { error: 'not_found' }, 'not_found');
    }
    if (p === '/api/buyer/summary' && req.method === 'GET') {
      const s = await db.campaignSummary(campaignInfo.campaign_id);
      return send(200, { campaign: manifest.title, buyer: manifest.buyer.name, accepted_claims: s.accepted, max_participants: manifest.max_participants,
        budget_zat: manifest.reward_zat * manifest.max_participants, committed_zat: manifest.reward_zat * s.accepted, payouts_by_status: s.payouts,
        payout_adapter: payoutAdapter.describe(), disclosure: manifest.disclosure });
    }
    if (p.startsWith('/api/')) return send(404, { error: 'not_found' }, 'not_found');
    return serveStatic(p, res);
  }

  function serveStatic(p, res) {
    const dist = join(ROOT, 'dist');
    let file = normalize(join(dist, decodeURIComponent(p)));
    if (!file.startsWith(dist)) { res.statusCode = 403; return res.end(); }
    // Pages: "/demo" -> dist/demo.html. Anything else unknown falls back to the homepage.
    if (!extname(file) && existsSync(`${file.replace(/\/$/, '')}.html`)) file = `${file.replace(/\/$/, '')}.html`;
    // A missing file with an extension (e.g. /crs/g2.dat before setup) is a 404, never the homepage.
    if (extname(file) && !existsSync(file)) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    if (!existsSync(file)) { res.statusCode = 503; res.setHeader('Content-Type', 'text/plain'); return res.end('Frontend not built. Run: npm run build'); }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    // Hashed build assets are immutable; prover engine and CRS files are checksum-pinned by setup, so cache them for a day.
    res.setHeader('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : /[\\/](bb|crs)[\\/]/.test(file) ? 'public, max-age=86400' : 'no-cache');
    res.end(readFileSync(file));
  }

  const server = createServer(async (req, res) => {
    const t = Date.now();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try { await route(req, res); }
    catch (e) {
      if (!res.headersSent) { res.statusCode = e.status ?? 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: e.reason ?? 'internal_error' })); }
      res.reason = e.reason ?? 'internal_error';
    } finally {
      const route = req.url.split('?')[0].replace(/[0-9a-f-]{36}/, ':id');
      if (route.startsWith('/api/')) log(`${new Date().toISOString()} ${req.method} ${route} ${res.statusCode} ${res.reason ?? '-'} ${Date.now() - t}ms`);
    }
  });
  return { server, db, params, campaignInfo, issuer };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Local default stays loopback-only; on Heroku (DYNO set) the web process must listen on all interfaces.
  const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? (process.env.DYNO ? '0.0.0.0' : '127.0.0.1');
  let app;
  try { app = await createApp(); }
  catch (e) { console.error(`VeilBounty failed to start: ${e.message}`); process.exit(1); } // never prints MONGODB_URI
  const { server, campaignInfo, db } = app;
  server.listen(port, host, () => {
    console.log(`VeilBounty on http://${host}:${port}`);
    console.log(`campaign ${campaignInfo.campaign_id} · issuer key ${campaignInfo.issuer.public_key.slice(0, 16)}… · payout adapter: ${campaignInfo.payout_adapter.label} · store: ${db.label}`);
  });
  // Heroku (and most hosts) send SIGTERM before restarting a dyno: stop accepting requests and close the store cleanly.
  const shutdown = () => { server.close(); db.close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
