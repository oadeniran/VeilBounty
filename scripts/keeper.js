// Durable zecd payout worker. A payout left in `sending` after a process crash must be
// reconciled against the wallet before anyone retries it; the keeper never retries it.
import { openStore } from '../src/server/db.js';
import { ZecdPayoutAdapter } from '../src/server/payout.js';

if (process.env.PAYOUT_ADAPTER !== 'zecd') throw new Error('Set PAYOUT_ADAPTER=zecd for the keeper process.');
if (!process.env.MONGODB_URI && process.env.DYNO) throw new Error('Heroku keeper requires MONGODB_URI; dyno-local SQLite is not shared or durable.');
const store = await openStore(process.env.MONGODB_URI
  ? { mongoUri: process.env.MONGODB_URI, mongoDbName: process.env.MONGODB_DB }
  : { dbPath: process.env.DB_PATH ?? '.data/veilbounty.sqlite' });
const wallet = new ZecdPayoutAdapter();
const pollMs = Math.max(5_000, Number(process.env.KEEPER_POLL_MS ?? 15_000));
const required = Math.max(1, Number(process.env.ZCASH_REQUIRED_CONFIRMATIONS ?? 1));
let stopping = false, busy = false;

async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    await store.reconcileStaleSends('zecd');
    const job = await store.claimNextPayout('zecd');
    if (job) {
      try {
        if (!job.address || !Number.isSafeInteger(job.amount_zat) || job.amount_zat <= 0) throw Object.assign(new Error('invalid queued payout data'), { definite: true });
        const txid = await wallet.broadcast({ address: job.address, amountZat: job.amount_zat, claimId: job.claim_id });
        await store.updatePayout(job.claim_id, { status: 'broadcast', txid, confirmations: 0, detail: 'Transaction broadcast; awaiting confirmation.', clearAddress: true });
        console.log(`payout ${job.claim_id} broadcast txid=${txid}`);
      } catch (e) {
        const uncertain = !!e.uncertain;
        await store.updatePayout(job.claim_id, {
          status: uncertain ? 'needs_reconciliation' : 'failed',
          detail: String(e.message ?? 'wallet send failed').slice(0, 220),
          clearAddress: !uncertain,
        });
        console.error(`payout ${job.claim_id} ${uncertain ? 'needs_reconciliation' : 'failed'}: ${String(e.message ?? e).slice(0, 220)}`);
      }
    }
    for (const item of await store.getBroadcastPayouts('zecd')) {
      try {
        const confirmations = await wallet.getConfirmations(item.txid);
        if (confirmations == null) continue;
        const confirmed = confirmations >= required;
        await store.updatePayout(item.claim_id, {
          status: confirmed ? 'confirmed' : 'broadcast', confirmations,
          detail: confirmed ? `Confirmed with ${confirmations} block(s).` : 'Transaction broadcast; awaiting confirmation.',
        });
        if (confirmed) console.log(`payout ${item.claim_id} confirmed txid=${item.txid} confirmations=${confirmations}`);
      } catch (e) { console.error(`confirmation lookup ${item.claim_id}: ${String(e.message ?? e).slice(0, 180)}`); }
    }
  } catch (e) { console.error(`keeper database error: ${String(e.message ?? e).slice(0, 180)}`); }
  finally { busy = false; }
}

console.log(`Zcash payout keeper started; store=${store.label}, confirmations=${required}.`);
await tick();
const timer = setInterval(tick, pollMs);
async function shutdown() {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  while (busy) await new Promise((resolve) => setTimeout(resolve, 100));
  await store.close(); process.exit(0);
}
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
