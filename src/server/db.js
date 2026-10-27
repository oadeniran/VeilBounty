// Persistence for the claim lifecycle: nullifier (replay protection), status, payout state.
// Two interchangeable backends behind one async interface:
//   - SQLite (default): a file at DB_PATH, or ':memory:' in tests.
//   - MongoDB: used when MONGODB_URI is set (e.g. MongoDB Atlas when hosting on Heroku, whose local disk is wiped).
// Neither stores rows, totals, witnesses or consent keys. The payout address is kept only until the payout adapter
// finishes (or the operator reports a manual payout), then removed.
//
// Store interface (all methods async):
//   recordAcceptedClaim({ id, campaignId, nullifier, maxParticipants, payout: { adapter, amountZat, address } })
//       -> null on success, 'already_claimed' (same campaign + nullifier) or 'campaign_full'. Atomic in both backends.
//   nullifierUsed(campaignId, nullifier) -> boolean
//   updatePayout(claimId, { status, txid?, detail?, clearAddress? })   txid is only ever set, never cleared
//   getPayout(claimId) -> { claim_id, adapter, status, amount_zat, txid, detail, updated_at } | null   (never the address)
//   payoutAddress(claimId) -> string | null          operator CLI and tests only
//   queuedPayouts() -> [{ claim_id, amount_zat, address }]   operator CLI only
//   campaignSummary(campaignId) -> { accepted, payouts: { [status]: count } }
//   close()
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function openStore({ dbPath, mongoUri, mongoDbName } = {}) {
  return mongoUri ? openMongo(mongoUri, mongoDbName) : openSqlite(dbPath);
}

// ---------------------------------------------------------------- SQLite
export function openSqlite(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      nullifier TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      UNIQUE (campaign_id, nullifier)
    );
    CREATE TABLE IF NOT EXISTS payouts (
      claim_id TEXT PRIMARY KEY REFERENCES claims(id),
      adapter TEXT NOT NULL,
      status TEXT NOT NULL,          -- queued | simulated | operator_reported | failed
      amount_zat INTEGER NOT NULL,
      address TEXT,                  -- cleared once the adapter finishes
      txid TEXT,                     -- only ever set from a real wallet or an operator report
      detail TEXT,
      updated_at INTEGER NOT NULL
    );`);
  return {
    kind: 'sqlite',
    label: path === ':memory:' ? 'SQLite (in memory)' : 'SQLite file',
    // Capacity check + insert in one transaction; UNIQUE(campaign_id, nullifier) enforces replay protection.
    async recordAcceptedClaim({ id, campaignId, nullifier, maxParticipants, payout }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM claims WHERE campaign_id = ?').get(campaignId);
        if (n >= maxParticipants) { db.exec('ROLLBACK'); return 'campaign_full'; }
        try {
          db.prepare('INSERT INTO claims (id, campaign_id, nullifier, accepted_at) VALUES (?, ?, ?, ?)').run(id, campaignId, nullifier, Date.now());
        } catch (e) {
          db.exec('ROLLBACK');
          if (String(e.message).includes('UNIQUE')) return 'already_claimed';
          throw e;
        }
        db.prepare('INSERT INTO payouts (claim_id, adapter, status, amount_zat, address, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, payout.adapter, 'queued', payout.amountZat, payout.address, Date.now());
        db.exec('COMMIT');
        return null;
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    },
    async nullifierUsed(campaignId, nullifier) {
      return !!db.prepare('SELECT 1 FROM claims WHERE campaign_id = ? AND nullifier = ?').get(campaignId, nullifier);
    },
    async updatePayout(claimId, { status, txid = null, detail = null, clearAddress = false }) {
      db.prepare(`UPDATE payouts SET status = ?, txid = COALESCE(?, txid), detail = ?, updated_at = ?${clearAddress ? ', address = NULL' : ''} WHERE claim_id = ?`)
        .run(status, txid, detail, Date.now(), claimId);
    },
    async getPayout(claimId) {
      return db.prepare('SELECT claim_id, adapter, status, amount_zat, txid, detail, updated_at FROM payouts WHERE claim_id = ?').get(claimId) ?? null;
    },
    async payoutAddress(claimId) {
      return db.prepare('SELECT address FROM payouts WHERE claim_id = ?').get(claimId)?.address ?? null;
    },
    async queuedPayouts() {
      return db.prepare("SELECT claim_id, amount_zat, address FROM payouts WHERE status = 'queued' ORDER BY updated_at").all();
    },
    async campaignSummary(campaignId) {
      const accepted = db.prepare('SELECT COUNT(*) AS n FROM claims WHERE campaign_id = ?').get(campaignId).n;
      const byStatus = db.prepare('SELECT p.status, COUNT(*) AS n FROM payouts p JOIN claims c ON c.id = p.claim_id WHERE c.campaign_id = ? GROUP BY p.status').all(campaignId);
      return { accepted, payouts: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) };
    },
    async close() { db.close(); },
  };
}

// ---------------------------------------------------------------- MongoDB
// One document per accepted claim, payout embedded, so every payout update is a single-document (atomic) write:
//   claims: { _id: claimId, campaign_id, nullifier, accepted_at, payout: { adapter, status, amount_zat, address?, txid, detail, updated_at } }
// Replay protection: unique index on (campaign_id, nullifier) — a second insert fails with duplicate key (11000).
// Capacity: each accepted claim must also take a numbered place, campaign_slots { _id: "<campaign>:<n>" } with
// n < max_participants. _id uniqueness gives every place exactly one owner, so concurrent claims cannot exceed the
// limit. This relies only on unique-key inserts (not on atomic findAndModify), so it also holds on FerretDB.
// If no place is left the claim document is removed again and the claim is refused as campaign_full.
const DUPLICATE_KEY = 11000;

function dbNameFromUri(uri) {
  try { const p = new URL(uri).pathname.replace(/^\//, ''); return p || null; } catch { return null; }
}

export async function openMongo(uri, dbName) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, appName: 'veilbounty' });
  try { await client.connect(); }
  catch (e) { throw Object.assign(new Error(`MongoDB connection failed (${e.name}). Check MONGODB_URI and the cluster's network access list.`), { code: 'mongo_unavailable' }); }
  const db = client.db(dbName || dbNameFromUri(uri) || 'veilbounty');
  const claims = db.collection('claims');
  const slots = db.collection('campaign_slots');
  await claims.createIndex({ campaign_id: 1, nullifier: 1 }, { unique: true, name: 'one_claim_per_nullifier' });
  await claims.createIndex({ 'payout.status': 1, 'payout.updated_at': 1 }, { name: 'payout_queue' });

  const row = (d) => (d ? { claim_id: d._id, adapter: d.payout.adapter, status: d.payout.status, amount_zat: d.payout.amount_zat,
    txid: d.payout.txid ?? null, detail: d.payout.detail ?? null, updated_at: d.payout.updated_at } : null);

  return {
    kind: 'mongodb',
    label: `MongoDB (${db.databaseName})`,
    async recordAcceptedClaim({ id, campaignId, nullifier, maxParticipants, payout }) {
      const now = Date.now();
      try {
        await claims.insertOne({ _id: id, campaign_id: campaignId, nullifier, accepted_at: now,
          payout: { adapter: payout.adapter, status: 'queued', amount_zat: payout.amountZat, address: payout.address, txid: null, detail: null, updated_at: now } });
      } catch (e) {
        if (e.code === DUPLICATE_KEY) return 'already_claimed';
        throw e;
      }
      // Take the lowest free place. Places are never released, so they stay contiguous from 0.
      try {
        for (let n = await slots.countDocuments({ campaign_id: campaignId }); n < maxParticipants; n++) {
          try { await slots.insertOne({ _id: `${campaignId}:${n}`, campaign_id: campaignId, claim_id: id }); return null; }
          catch (e) { if (e.code !== DUPLICATE_KEY) throw e; }
        }
      } catch (e) { await claims.deleteOne({ _id: id }); throw e; }
      await claims.deleteOne({ _id: id });
      return 'campaign_full';
    },
    async nullifierUsed(campaignId, nullifier) {
      return !!(await claims.findOne({ campaign_id: campaignId, nullifier }, { projection: { _id: 1 } }));
    },
    async updatePayout(claimId, { status, txid = null, detail = null, clearAddress = false }) {
      const $set = { 'payout.status': status, 'payout.detail': detail, 'payout.updated_at': Date.now() };
      if (txid != null) $set['payout.txid'] = txid;
      await claims.updateOne({ _id: claimId }, clearAddress ? { $set, $unset: { 'payout.address': '' } } : { $set });
    },
    async getPayout(claimId) {
      return row(await claims.findOne({ _id: claimId }, { projection: { 'payout.address': 0 } }));
    },
    async payoutAddress(claimId) {
      return (await claims.findOne({ _id: claimId }, { projection: { 'payout.address': 1 } }))?.payout?.address ?? null;
    },
    async queuedPayouts() {
      const docs = await claims.find({ 'payout.status': 'queued' }, { projection: { 'payout.amount_zat': 1, 'payout.address': 1 } }).sort({ 'payout.updated_at': 1 }).toArray();
      return docs.map((d) => ({ claim_id: d._id, amount_zat: d.payout.amount_zat, address: d.payout.address ?? null }));
    },
    async campaignSummary(campaignId) {
      const accepted = await claims.countDocuments({ campaign_id: campaignId });
      const byStatus = await claims.aggregate([{ $match: { campaign_id: campaignId } }, { $group: { _id: '$payout.status', n: { $sum: 1 } } }]).toArray();
      return { accepted, payouts: Object.fromEntries(byStatus.map((r) => [r._id, r.n])) };
    },
    async close() { await client.close(); },
    async dropDatabase() { await db.dropDatabase(); }, // tests only
  };
}
