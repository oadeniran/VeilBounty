# VeilBounty — submission description

**Buyers pay for verified answers about private data, without receiving the data.**

A market-research buyer asks: *did this person spend $200–$500 on groceries in September 2026?* The participant's browser answers with a zero-knowledge proof over purchase records that the merchant signed. The buyer learns "yes" and that it is genuine. It never sees the purchases or the total.

## What works today

- **Records, not just totals, are authenticated.** The issuer signs a Poseidon2 commitment over all 64 padded records. Editing any record, even in a way that keeps the total the same, makes a proof impossible.
- **Buyer-chosen questions.** Category, date range and spend range are public campaign inputs, so one signed statement can answer different campaigns.
- **Proving in the browser.** A Noir circuit with UltraHonk via bb.js runs in a Web Worker and takes about 2.5 s. The browser test checks every request made by the page and its workers. No record, total or witness value leaves the device, and the app contacts no third party: WASM, the proving CRS and fonts are all self-hosted under a strict CSP.
- **Guards against claim abuse.**
  - The payout address is bound into the proof, so a stolen proof cannot redirect the reward.
  - A campaign-scoped nullifier with an atomic database constraint stops replays.
  - A signed consent receipt ties the claim to the exact terms the participant approved.
- **Testing.** There are 59 Node tests and 22 browser checks. All of them use real proofs, and they pass from a clean clone.

## Why Zcash

In a data-compensation market, the payment is part of the data. A public transfer of a campaign reward reveals that the recipient qualified, which is exactly what the proof hid. Settlement therefore has to be shielded. The payout path targets Ironwood shielded addresses and refuses transparent ones.

## What this prototype does not do (stated plainly)

- **No real Zcash transaction was sent.** We couldn't get a funded Ironwood testnet wallet in time, so payouts are labelled *simulated* and never show a transaction id. A manual mode lets an operator record a payment they really sent, and it is shown as *operator-reported*, not confirmed.
- **The issuer is a mock**, and its data is synthetic.
- **The operator verifies proofs and controls funds.** Nothing here is trustless or decentralised.
- **Claims from one statement are linkable** in this version, because the credential's commitment is visible to the verifier. Next step: verify the issuer signature inside the circuit.
- **No network-level privacy.**

## Next

1. Verify the issuer signature in-circuit to hide the root.
2. Make a genuine Ironwood payout through zecd with a Zebra node.
3. Threshold (FROST) custody of campaign funds.
4. A real issuer pilot.
