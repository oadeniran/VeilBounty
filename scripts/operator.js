// Operator CLI for the MANUAL payout adapter. Runs on the operator's machine against the verifier's store:
// the MongoDB at MONGODB_URI if set (works from a laptop against a hosted app), otherwise the SQLite file at DB_PATH.
//   node scripts/operator.js list                    -> queued payouts (claim id, amount, address)  [operator-only view]
//   node scripts/operator.js report <claim_id> <txid> -> record a txid the operator ACTUALLY sent from their own wallet
// This tool cannot check the chain. Recorded payouts are shown as "operator_reported", never "confirmed".
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/server/db.js';

const store = await openStore(process.env.MONGODB_URI
  ? { mongoUri: process.env.MONGODB_URI, mongoDbName: process.env.MONGODB_DB }
  : { dbPath: process.env.DB_PATH ?? fileURLToPath(new URL('../.data/veilbounty.sqlite', import.meta.url)) });
const [cmd, claimId, txid] = process.argv.slice(2);
let code = 0;
try {
  if (cmd === 'list') {
    const rows = await store.queuedPayouts();
    if (!rows.length) console.log('No queued payouts.');
    for (const r of rows) console.log(`${r.claim_id}  ${(r.amount_zat / 1e8).toFixed(8)} TAZ  ${r.address}`);
  } else if (cmd === 'report') {
    if (!/^[0-9a-f-]{36}$/.test(claimId ?? '') || !/^[0-9a-f]{64}$/.test(txid ?? '')) { console.error('usage: report <claim_id> <64-hex txid>'); code = 2; }
    else {
      const p = await store.getPayout(claimId);
      if (!p) { console.error('unknown claim'); code = 1; }
      else if (p.adapter !== 'manual' || p.status !== 'queued') { console.error(`payout is ${p.adapter}/${p.status}; only queued manual payouts can be reported`); code = 1; }
      else {
        await store.updatePayout(claimId, { status: 'operator_reported', txid, detail: 'Transaction id reported by the operator; not verified on-chain by this app.', clearAddress: true });
        console.log('recorded as operator_reported; payout address removed from the database');
      }
    }
  } else { console.error('usage: node scripts/operator.js list | report <claim_id> <txid>'); code = 2; }
} finally { await store.close(); }
process.exit(code);
