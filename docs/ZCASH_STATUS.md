# Zcash integration status

The default payout remains `simulated`. Automated testnet transfers are available with `PAYOUT_ADAPTER=zecd` and a separately running, funded wallet; they are real transactions and require operator funding and monitoring.

## Spike (26 October 2026)

| Question | Finding |
| --- | --- |
| Active shielded pool | Ironwood (NU6.3); testnet activation at block 4,134,000 (4 July 2026). Orchard is withdrawal-only. Payments must use V6 transactions. |
| `zcashd` / `zcash-cli` | End-of-support halt reached 18 July 2026; not usable. |
| `zecd` (Ironwood wallet server, bitcoind-style RPC) | Zebra is the default backend; current zecd also supports a lightwalletd backend, including the `zecrocks` preset. The wallet must remain available and funded for automated sends. |
| Zallet | Alpha; also needs Zebra. Not attempted. |
| Testnet funds (TAZ) | Faucet or Zcash Discord; needs a human. Not obtainable from the build sandbox. |

## What is implemented

- `SimulatedPayoutAdapter` (default): records `simulated`; no funds move; no txid.
- `ManualPayoutAdapter` (`PAYOUT_ADAPTER=manual`): claims queue a payout; the operator sends the reward from their own Ironwood-capable testnet wallet, then runs `node scripts/operator.js report <claim_id> <txid>`. The status becomes `operator_reported`. The app cannot verify the transaction on-chain and never shows it as confirmed. The payout address is deleted from the database when the report is recorded.
- `ZecdPayoutAdapter` (`PAYOUT_ADAPTER=zecd`): claims queue payout records; `scripts/keeper.js` claims each row once, calls the wallet's `sendtoaddress`, stores the txid, and polls `gettransaction` for confirmations. The UI shows the txid and confirmation count. Ambiguous send outcomes are put into `needs_reconciliation` and are never automatically retried; the operator must inspect the wallet first.

## What remains operator-controlled

The operator funds and configures the wallet. For `zecd` mode, the verifier queues an accepted claim and the keeper sends it automatically. A shielded address is not an escrow contract; Zcash cannot verify the claim proof or enforce campaign rules.

## To make a genuine payment before submission

1. Run an Ironwood-capable zecd testnet wallet connected to its required chain backend, and fund it with TAZ.
2. Configure `PAYOUT_ADAPTER=zecd`, wallet RPC URL and credentials; on Heroku, use Atlas for the shared queue and run `web=1 worker=1`.
3. Keep wallet RPC private. Use localhost for a co-located local process; for Heroku, configure a remote HTTPS endpoint with a valid certificate. The keeper rejects remote plaintext HTTP. Do not expose Basic-auth RPC over plaintext HTTP.
4. Complete a claim with a shielded testnet address. Watch the claim page or `GET /api/claims/<claim_id>/payout` for status and txid; the keeper marks it `confirmed` after the configured confirmation threshold.
5. For `needs_reconciliation`, inspect the wallet and chain before any manual correction. Do not rerun the send.
