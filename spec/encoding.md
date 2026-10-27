# Canonical encoding (veilbounty-rows-v1)

One encoding is shared by the issuer (`src/server/issuer.js`), the browser prover (`web/src/prover.worker.js`), the verifier (`src/server/verifier.js`) and the circuit (`circuits/claim/src/main.nr`). The JS implementation is `src/shared/encoding.js` and `src/shared/hash.js`. Golden vectors are in `test-vectors.json` and are re-derived inside Noir by `test/parity.test.js`.

## Field and hash

All values are elements of the BN254 scalar field. `H(x1..xn)` is the Poseidon2 sponge from `noir-lang/poseidon` v0.4.0 (`Poseidon2::hash(input, n)`; rate 3, IV = n·2^64), identical to Barretenberg's `poseidon2Hash` in `@aztec/bb.js` 5.2.1. Domain separators: ROOT = 1, HOLDER = 2, NULLIFIER = 3, RECIPIENT = 4.

## Records

| Field | Type | Encoding |
| --- | --- | --- |
| amount | u32 | integer cents, 1 ≤ amount ≤ 2^32−1; input text must be a positive decimal with at most 2 places |
| category | u32 | registry id: 1 rent, 2 transport, 3 groceries, 4 dining, 5 utilities, 6 entertainment, 7 health, 8 other; 0 is reserved for padding |
| day | u32 | days since 2026-01-01 UTC; real records must be ≥ 1 (2026-01-02 or later); 0 is reserved for padding |

Rows are sorted by (day, category, amount) ascending, then padded to exactly 64 rows with (0, 0, 0). More than 64 records is an error; nothing is truncated. Each row packs to `amount + category·2^32 + day·2^64`.

## Constructions

```
holder_commitment = H(2, holder_secret)
root              = H(1, row_0, …, row_63, blind, holder_commitment)        # 67 inputs
nullifier         = H(3, holder_secret, campaign_id)
recipient_hash    = H(4, byte_length, chunk_0, …, chunk_7)                  # address ASCII, 31 bytes per chunk, big-endian, zero-padded
campaign_id       = SHA-256(canonical_json(manifest)) with the top 3 bits cleared, as a field element
```

Addresses are canonicalised by trimming and lower-casing single-case Bech32 strings; mixed case and non-testnet prefixes are rejected (max 248 bytes).

`canonical_json` sorts object keys, emits no whitespace, and allows only safe integers. Credentials and consent receipts are Ed25519 signatures over the UTF-8 bytes of `canonical_json(body)`.

## Public inputs (circuit ABI order)

`root, campaign_id, category, day_from, day_to, min_cents, max_cents, recipient_hash, nullifier`, each a 32-byte big-endian hex string in the claim.
