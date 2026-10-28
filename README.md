# VeilBounty

A buyer pays for a **verified answer** about a participant's private purchase records — "spent $200–$500 on groceries in September 2026" — without receiving the records. The participant's browser proves the answer with a Noir zero-knowledge proof over issuer-signed records. Rewards are meant to settle privately on Zcash, because a public payment for a private fact publishes the fact. In this build payouts are **simulated** (see `docs/ZCASH_STATUS.md`).

Zecathon prototype. Synthetic data only.

## How it works

1. **Enroll.** The browser makes a holder secret and sends only its commitment to the mock issuer. The issuer commits to its 64 padded records, a fresh blind and that commitment (Poseidon2 root), signs the credential (Ed25519), and returns the records and blind to the participant.
2. **Consent.** The participant reviews the campaign terms and approves; a consent receipt is signed binding the manifest hash, credential root, payout-address hash and nullifier.
3. **Prove locally.** In a Web Worker, the circuit proves the records reproduce the signed root, the matching rows sum to within the campaign range, and the nullifier derives from the holder secret and campaign.
4. **Verify.** The verifier checks the pinned issuer signature, recomputes every public input (including the recipient hash from the actual payout address), checks consent, verifies the UltraHonk proof, and atomically records the nullifier.
5. **Pay.** The payout adapter runs: `simulated` by default, `manual` (operator sends and reports the txid), or `zecd` (the keeper sends from a funded testnet wallet and tracks confirmations).

What crosses the network: the holder commitment (to the issuer) and the six-field claim (to the verifier). Never: records, totals, the blind or the holder secret. This is asserted by `npm run test:browser`.

## Requirements

- Node.js ≥ 22.5 (uses `node:sqlite`)
- Nargo 1.0.0-rc.5: `curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash && noirup -v 1.0.0-rc.5`
- Network access during setup only (npm, the Noir poseidon library, the public Aztec CRS file)

## Run

```bash
npm ci
npx playwright install chromium     # only for the browser test
npm run setup                       # issuer key -> .data/ (gitignored); CRS + Barretenberg WASM -> web/public/ (checksums pinned)
npm run build                       # nargo compile + nargo test + vite build
npm start                           # http://127.0.0.1:8787 (homepage) and /demo (the claim flow)
```

Configuration is by environment variable; see `.env.example`.

For the short path, `npm run init` runs the one-time setup and builds the web app. Copy `.env.example` to `.env`, replace the wallet RPC password, then run `npm run start:all`. It starts zecd with the configured testnet backend (or reuses a running wallet), verifies it is on testnet, then starts the web app and keeper. Press Ctrl+C to stop processes started by the launcher. `.env` is ignored by git.

**Windows (PowerShell):** run `npm ci` before `npm run setup`. Nargo has no native Windows build, so use `npm run build:web` instead of `npm run build` (the compiled circuit `circuits/claim/target/claim.json` is committed; recompile only under WSL). Set variables with `$env:PAYOUT_ADAPTER="manual"; npm start`. Use the git bundle or a clone rather than the zip: one Node test checks what git tracks. Reset the demo by deleting `.data/veilbounty.sqlite*`.

## Test

```bash
npm test               # 59 Node tests: parity vectors, circuit soundness, verifier negatives, privacy of logs/APIs, payouts
npm run test:browser   # real UI, real in-browser proof, network privacy, attacks (needs the CRS from setup)
npm run test:ui        # 37 UI checks: every screen and state, failure paths, manual payouts, mobile layout (no CRS needed; proof mocked)
npm run vectors        # regenerate spec/test-vectors.json (parity test fails if it drifts)
```

## Storage

Two interchangeable stores behind one interface (`src/server/db.js`). Both hold only what the claim lifecycle needs — nullifiers (replay protection), claim status, payout state, and a payout address until that payout is recorded. Never rows, totals or witness values.

- **SQLite** (default): the file at `DB_PATH` (default `.data/veilbounty.sqlite`). Best for local runs and tests.
- **MongoDB**: used whenever `MONGODB_URI` is set; database name from `MONGODB_DB`, else the URI path, else `veilbounty`. Replay protection is a unique index on (campaign, nullifier); campaign capacity uses numbered place documents whose unique `_id` gives each place one owner, so concurrent claims cannot exceed the limit. The server refuses to start if MongoDB is unreachable.

Run the test suite against MongoDB with `TEST_MONGODB_URI=<uri> npm test` (each test app uses a throwaway `vbtest_*` database that is dropped afterwards; the database user needs read/write on any database).

## Deploy to Heroku

The app defines separate `web` and `worker` Procfile processes. Use MongoDB Atlas as the shared store because Heroku dynos have separate ephemeral filesystems. Genuine payouts also require a separately hosted, funded zecd wallet reachable by the worker over HTTPS. The full setup, config variables, deployment, scaling, verification and recovery steps are in [the deployment runbook](docs/DEPLOYMENT.md).

The Heroku build uses `heroku-postbuild` to run `npm run setup` and `npm run build:web`; Node 24 is specified in `package.json`. A build generates a new mock issuer key, so statements from a previous deploy stop verifying after redeployment.

## Interface

The UI follows the design workspace (screens D1–D8, homepage, responsive and accessibility board). It is plain JavaScript, no framework, and contains no inline styles or scripts, so the strict CSP stays unchanged.

- `/` homepage; `/demo` the claim flow: Campaign → Statement → Consent → Proof → Verify → Reward, plus **Security lab** (`#lab`) and **History** (`#history`).
- Everything shown comes from the manifest (`fixtures/campaign.json`), the issued statement, the worker or the verifier response. Nothing is hard-coded per campaign.
- The browser checks the issuer's Ed25519 signature against the pinned key before showing "Signature valid".
- The header chip ("0 B of records sent") and the History privacy summary are measured: every outgoing request body is searched for the statement's dates, amounts, merchants, total and blind before it is sent.
- The edited-records attack runs in the worker and is stopped there (no proof can exist), so it makes no request; the lab and the audit say so.
- If `npm run setup` has not been run, the server still starts: the statement step works and proving shows a clear "prover files missing" error, and claims are refused with `verifier_unavailable`.
- Dev server: `npm start` in one shell and `npm run dev` in another (Vite proxies `/api`). If Playwright's own Chromium is not installed, set `CHROMIUM_PATH` for the browser tests.

## Operator (manual payouts)

```bash
PAYOUT_ADAPTER=manual npm start
node scripts/operator.js list
node scripts/operator.js report <claim_id> <txid>   # only for a transaction you actually sent
```

## Automated testnet keeper

The web app queues verified claims. The keeper sends from zecd, stores the txid, and tracks confirmations. See [the deployment runbook](docs/DEPLOYMENT.md) for the Heroku topology, required config vars, local startup, verification, and payout recovery instructions. A public lightwalletd endpoint is the wallet's chain backend; the keeper connects to zecd's wallet RPC.

## Layout

```
circuits/claim/       Noir circuit (row-committed predicate, nullifier, recipient binding)
src/shared/           encoding, Poseidon2 constructions, campaign, consent, credential, participant protocol (browser + Node)
src/server/           HTTP server, verifier, mock issuer, SQLite, payout adapters
web/                  homepage (index.html), claim flow (demo.html), prover Web Worker
  src/styles/         design-system CSS ported from the design workspace (ds-*.css) + layouts (app.css, home.css)
  src/lib/            DOM helpers, design-system components as plain functions, logo motion
  src/app/            claim flow (claim.js), security lab, history/audit, request log + leak scan (net.js)
scripts/              setup, golden vectors, operator CLI, browser e2e, benchmark
spec/                 canonical encoding and golden vectors
docs/                 threat model, Zcash status, demo script, acceptance results
```

## Limits

Mock issuer; credential root visible to the verifier (claims from one statement are linkable); operator runs verification and holds funds; no genuine Zcash payment in this build; no network-level privacy. Details in `docs/THREAT_MODEL.md`.
