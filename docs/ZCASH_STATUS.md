# Zcash integration status

**No shielded testnet transaction was sent by this build.** Every payout in the default configuration is `simulated`, is labelled as such in the UI and API, and never carries a transaction id.

## Spike (26 October 2026)

| Question | Finding |
| --- | --- |
| Active shielded pool | Ironwood (NU6.3); testnet activation at block 4,134,000 (4 July 2026). Orchard is withdrawal-only. Payments must use V6 transactions. |
| `zcashd` / `zcash-cli` | End-of-support halt reached 18 July 2026; not usable. |
| `zecd` (Ironwood wallet server, bitcoind-style RPC) | Requires a self-hosted Zebra full node. Not feasible in the 1-CPU build sandbox before the deadline. |
| Zallet | Alpha; also needs Zebra. Not attempted. |
| Testnet funds (TAZ) | Faucet or Zcash Discord; needs a human. Not obtainable from the build sandbox. |

## What is implemented

- `SimulatedPayoutAdapter` (default): records `simulated`; no funds move; no txid.
- `ManualPayoutAdapter` (`PAYOUT_ADAPTER=manual`): claims queue a payout; the operator sends the reward from their own Ironwood-capable testnet wallet, then runs `node scripts/operator.js report <claim_id> <txid>`. The status becomes `operator_reported`. The app cannot verify the transaction on-chain and never shows it as confirmed. The payout address is deleted from the database when the report is recorded.

## What remains operator-controlled

The operator holds the campaign funds, decides when to pay, and sees each payout address until the payout is recorded. A shielded address is not an escrow contract; Zcash cannot verify the claim proof or enforce campaign rules.

## To make a genuine payment before submission

1. Run an Ironwood-capable testnet wallet (for example zecd with a local Zebra, or a mobile/desktop wallet that supports V6 transactions on testnet) and obtain TAZ.
2. Start the app with `PAYOUT_ADAPTER=manual`, complete a claim using a shielded testnet address you control.
3. `node scripts/operator.js list`, send the listed amount to the listed address with a memo of your choice, then `node scripts/operator.js report <claim_id> <txid>`.
4. Confirm receipt in the recipient wallet, and record the txid and status in `docs/ACCEPTANCE.md`.
