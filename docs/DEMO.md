# Two-minute demo script

Setup before going live: `npm run setup && npm run build && npm start`, open http://127.0.0.1:8787/demo in a fresh window with DevTools → Network open. Fresh database: delete `.data/veilbounty.sqlite*` before starting. (The homepage at `/` is a good opening shot.)

| Time | Action | Say |
| --- | --- | --- |
| 0:00 | Show the campaign headline | "A buyer wants to know: did this person spend $200–$500 on groceries in September? They'll pay for a verified yes. They should never see the purchases." |
| 0:12 | **Start campaign** → **Get synthetic statement** | "Mock Grocer signs a fingerprint of the records. The browser checks that signature itself. The rows stay here; highlighted rows are what the campaign counts — the $347.85 total never leaves." |
| 0:30 | **Review consent**, **Use demo address**, tick the box | "Every term is shown before anything is computed: purpose, exact disclosure, retention, what withdrawal can't undo. The payout address gets locked into the proof." |
| 0:42 | **Approve and generate proof** | "The proof is made here, in a Web Worker, in a couple of seconds. The line in the privacy box is measured: only public prover files were downloaded, zero bytes sent." |
| 0:58 | **Review claim**, then **Submit claim** | "This is the entire package the verifier gets. The buyer sees one thing: qualifies, yes. Accepted." |
| 1:10 | Point at the payout card | "Payout is honestly labelled simulated: no Zcash transaction, no fake transaction id. On Zcash that payment would be shielded, because paying someone for a private fact on a public chain publishes the fact." |
| 1:20 | **Open security lab** → **Run tampered records** | "Move ten dollars between two rows: same total, still qualifies on paper — but it no longer matches the signature, so no proof can exist. It stopped on this device; nothing was sent." |
| 1:35 | **Run replay**, **Run redirection** | "Replay: rejected, one claim per statement per campaign. Stealing the proof to redirect the reward: rejected, the address is bound in. Three of three." |
| 1:48 | **History** → expand **Technical privacy details** | "Every request this page made, and a scan of every outgoing body: zero statement rows. Limits: mock issuer, operator-run verifier, credentials linkable in this version." |

Backup: if anything fails live, play a screen recording made with the same steps. `npm run test:ui` checks every screen in seconds before you start.
