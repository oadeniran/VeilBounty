# Threat model and known limitations

## Trust assumptions

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| Issuer (Mock Grocer) | Signing true records and keeping its key safe | Seeing which campaigns a participant joins (it never receives claims) |
| Participant's browser and the served app code | Keeping records, blind and holder secret local | — (a malicious frontend defeats local privacy; see below) |
| Operator (verifier + payouts) | Running the verifier honestly, not logging, paying out | Learning records or totals (it never receives them) |
| Buyer | Honouring retention and resale terms | Receiving anything beyond "qualifies: yes" and counts |

## Threats and mitigations

| Threat | Mitigation in this build | Residual risk |
| --- | --- | --- |
| Altered records, including sum-preserving edits | Circuit recomputes the issuer-signed root over all 64 rows | None found in tests |
| Forged credential / substituted root | Ed25519 signature checked against a pinned issuer key; root must equal public input | Issuer key compromise |
| Proof theft and payout redirection | Recipient hash is a public input; verifier recomputes it from the actual address | None found in tests |
| Replay, same or fresh proof | Campaign-scoped nullifier; SQLite `UNIQUE(campaign_id, nullifier)`; invalid proofs never consume it | One claim per statement, not per person |
| Cross-campaign replay | campaign_id (hash of the whole manifest) is a public input and in the nullifier | — |
| Consent bypass | Verifier requires a receipt bound to manifest, root, recipient and nullifier; UI only proves after approval | Consent key is per session; it does not prove identity |
| Re-identifying campaigns (very narrow ranges) | Manifest policy rejects ranges under $100 | A buyer can still combine several campaigns |
| Data riding along in claims | Verifier accepts exactly six fields | — |
| Exfiltration by third-party scripts | CSP `default-src 'self'`, no analytics, fonts/WASM/CRS self-hosted; browser test asserts zero third-party requests | A compromised server can serve malicious code |
| Logging leaks | Log line = method, route, status, reason code; tests assert no addresses, totals or bodies in logs | Reverse proxies and hosting logs are outside this code |
| Sybil participants | Issuer issues one statement per account (mock: unlimited) | **Mock issuer provides no Sybil resistance** |
| Network metadata | None | IP and timing visible to the operator |
| Payout fraud / custody | Simulated by default; manual payouts recorded as operator_reported | Operator holds funds |

## Known limitations

1. **Linkability.** The credential root is a public input and is visible to the verifier, so two claims from one statement can be linked, and an issuer colluding with the operator could identify a claimant. Fix: verify the issuer signature inside the circuit and keep the root private.
2. **Mock issuer.** Records and issuer are synthetic. Nothing here authenticates real merchant data.
3. **No genuine Zcash payment** in this build (see `ZCASH_STATUS.md`).
4. **Operator trust.** Off-chain verification and operator-held funds; nothing is trustless or decentralised.
5. **Contractual terms.** Retention, no-resale and revocation are promises in the manifest, not cryptographic guarantees. Revocation cannot erase an answer already delivered.
6. **Consent ≠ identity.** The consent signature proves that whoever submitted the claim approved its terms, nothing more.
7. **Holder secret lives in tab memory.** Closing the tab loses it; the statement cannot then be used. No secure storage is implemented.
8. **Single campaign, single issuer, 64-row limit.**
9. **Rate limiting** is a simple in-memory per-IP limit.
