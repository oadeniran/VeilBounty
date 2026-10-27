// Generates spec/test-vectors.json: six datasets differing in exactly one aspect, with JS-computed roots.
import { writeFileSync, readFileSync } from 'node:fs';
import { getHashApi } from '../src/server/zk.js';
import { parseCsv, canonicalRows, padRows, fieldToHex } from '../src/shared/encoding.js';
import { computeRoot, holderCommitment, nullifierFor, recipientHash } from '../src/shared/hash.js';

export const FIXED = { holderSecret: 0x1234567890abcdefn, blind: 0x0fedcba987654321n, campaignId: 777n,
  address: 'utest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' };

export async function buildVectors() {
  const api = await getHashApi();
  const records = parseCsv(readFileSync(new URL('../fixtures/mock-grocer-records.csv', import.meta.url), 'utf8'));
  const base = padRows(canonicalRows(records));
  const swapOrder = base.map((r) => ({ ...r })); [swapOrder[0], swapOrder[1]] = [swapOrder[1], swapOrder[0]];
  const amt = base.map((r) => ({ ...r })); amt[3].amount += 1;
  const cat = base.map((r) => ({ ...r })); cat[3].category = 4;
  const day = base.map((r) => ({ ...r })); day[3].day += 1;
  const hc = holderCommitment(api, FIXED.holderSecret);
  const cases = [
    ['valid', base, FIXED.blind], ['row_order_swapped', swapOrder, FIXED.blind], ['amount_changed', amt, FIXED.blind],
    ['category_changed', cat, FIXED.blind], ['date_changed', day, FIXED.blind], ['blind_changed', base, FIXED.blind + 1n],
  ];
  return {
    note: 'Golden vectors. Regenerate with `npm run vectors`; test/parity.test.js re-derives every root in Noir.',
    holder_secret: fieldToHex(FIXED.holderSecret), holder_commitment: fieldToHex(hc),
    campaign_id: fieldToHex(FIXED.campaignId), nullifier: fieldToHex(nullifierFor(api, FIXED.holderSecret, FIXED.campaignId)),
    recipient_address: FIXED.address, recipient_hash: fieldToHex(recipientHash(api, FIXED.address)),
    vectors: cases.map(([name, rows, blind]) => ({ name, blind: fieldToHex(blind), rows, root: fieldToHex(computeRoot(api, rows, blind, hc)) })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = await buildVectors();
  writeFileSync(new URL('../spec/test-vectors.json', import.meta.url), JSON.stringify(v, null, 1) + '\n');
  console.log('wrote spec/test-vectors.json'); v.vectors.forEach((x) => console.log(x.name.padEnd(20), x.root));
  process.exit(0);
}
