# Acceptance checklist — actual results

Recorded 26 October 2026 in the build sandbox (Linux x86_64, 1 vCPU, Node 22.22.2, nargo 1.0.0-rc.5, noir_js 1.0.0-rc.5, bb.js 5.2.1, headless Chromium 140). Every result below comes from a command that was run; nothing was verified by inspection alone.

| Criterion | Result | Evidence |
| --- | --- | --- |
| Clean setup starts the app using the README | **Pass** | Fresh `git clone` → `npm ci` → `npm run setup` → `npm run build` → `npm start`; index, WASM and API served |
| Synthetic credential issued and signature-verified | **Pass** | e2e tests; browser check "statement matches issuer signature locally" |
| Circuit proves the row-committed predicate | **Pass** | 6 golden vectors re-derived in Noir; 21 circuit/encoding tests |
| Verifier accepts a genuine proof and rejects invalid cases | **Pass** | 24 verifier tests with real UltraHonk proofs |
| Consent, recipient binding, replay protection enforced | **Pass** | Node tests + browser attack checks |
| Private CSV and witness values do not cross the browser → verifier boundary | **Pass** | Browser test inspects every page and worker request: no row values, dates, merchants, total, or issuer blind in any body; zero third-party requests |
| Interface explains what is private and what is disclosed | **Pass** (manual review of screenshot) | `docs/ui-after-claim.png` |
| Payment screen reports a genuine result or a labelled fallback | **Pass (fallback)** | Simulated, labelled in UI and API, no txid. **No genuine Zcash transaction was sent.** |
| Demo runs start to finish without editing internal state | **Pass** | Browser test runs the full demo including all three attacks |
| Documented results reflect tests actually run | **Pass** | This file |

## Test runs

| Suite | Command | Result |
| --- | --- | --- |
| Node (parity, circuit, verifier, privacy, payouts) | `npm test` | 59 passed, 0 failed, 0 skipped (also 59/59 from a clean clone) |
| Browser end-to-end and network privacy | `npm run test:browser` | 22 passed, 0 failed (also 22/22 from a clean clone) |
| Noir unit test | `nargo test` | 1 passed |

## Measurements

| Measure | Value |
| --- | --- |
| Circuit size | 2,234 ACIR opcodes; 7,031 gates (8,192 dyadic) |
| Proving, Node, 1 thread | 1.3 s |
| Proving, headless Chromium, Web Worker | 2.3–2.8 s across runs |
| Verification | 134 ms |
| Proof size | 14,656 bytes |
| Claim request size | about 21.7 KB |

## Failures found and fixed during the build

- bb.js loads WASM from an inline `data:` URL, which the CSP blocks. Fixed by serving WASM from our own origin; the CSP was not loosened.
- bb.js requires the compressed CRS in 4 MiB blocks. Fixed; the checksum matches the file bb.js downloads itself.
- Worker network log mislabelled `URL` objects as `/assets/undefined`. Fixed and covered by a browser check.
- Expiry test originally accepted three possible reasons. Replaced with a strict test that isolates credential expiry.

## Not done

- Genuine Ironwood testnet payment (see `ZCASH_STATUS.md`).
- Issuer signature verification inside the circuit (root remains linkable).
- Deployment to a public host. The app runs locally.
- Manual cross-browser testing (only headless Chromium was exercised).

## UI redesign (27 October 2026)

New interface built from the design workspace (homepage, screens D1–D8, responsive and accessibility rules). Backend, circuit and protocol unchanged except: the server serves `/demo`, loads the CRS from `web/public/crs/` instead of the Aztec CDN at runtime, starts without the CRS (claims return `verifier_unavailable` until setup has run), and returns 404 for missing static files.

Recorded in a build sandbox that cannot reach the Aztec CRS host, so no real proof could be generated there:

| Suite | Command | Result |
| --- | --- | --- |
| UI smoke (every screen and state; proof and verifier replies mocked) | `npm run test:ui` | 37 passed, 0 failed |
| Node | `npm test` | 33 passed; the 26 proof-dependent tests could not run (CRS missing) |
| Browser end-to-end and network privacy | `npm run test:browser` | **Not run in the sandbox.** Updated for the new UI (now 29 checks); must be run with the CRS before submission |

## MongoDB store (27 October 2026)

Optional MongoDB backend behind the same store interface, selected by `MONGODB_URI`. Official MongoDB server downloads were unreachable from the build sandbox, so the MongoDB path was tested against FerretDB 1.24 (MongoDB wire protocol, SQLite backend) using the official `mongodb` 7.7.0 driver. It has not yet been run against MongoDB Atlas itself.

| Check | Result |
| --- | --- |
| Store contract tests (`test/store.test.js`), SQLite | 3 passed |
| Store contract tests, MongoDB protocol (`TEST_MONGODB_URI`) | 3 passed, three consecutive runs |
| 60 concurrent claims (50 distinct + 10 copies of one nullifier), 10 places | exactly 10 accepted on both stores; duplicates rejected |
| Server on MongoDB: buyer summary, payout lookup, operator CLI, SIGTERM shutdown, unreachable URI fails closed at startup | Pass |

Found and fixed during this work: an earlier counter design (conditional `findOneAndUpdate` upsert) admitted 11 of 12 concurrent claims into a 5-place campaign on FerretDB, which does not apply that update atomically. Capacity now relies only on unique-key inserts.
