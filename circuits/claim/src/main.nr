// VeilBounty claim circuit (MVP).
// Proves: issuer-committed rows (+ blind + holder commitment) reproduce `root`;
// the sum of rows matching the campaign category and day range lies in [min_cents, max_cents];
// the nullifier is derived from the holder secret and campaign id; recipient_hash is bound as a public input.
// Encoding is specified in spec/encoding.md and must match src/shared/encoding.js.
use poseidon::poseidon2::Poseidon2;

global N: u32 = 64;
global MAX_CATEGORY: u32 = 8; // registry ids 1..=8; 0 = padding
global DOMAIN_ROOT: Field = 1;
global DOMAIN_HOLDER: Field = 2;
global DOMAIN_NULLIFIER: Field = 3;
global TWO_POW_32: Field = 4294967296;
global TWO_POW_64: Field = 18446744073709551616;

pub fn pack_row(amount: u32, category: u32, day: u32) -> Field {
    (amount as Field) + (category as Field) * TWO_POW_32 + (day as Field) * TWO_POW_64
}

pub fn holder_commitment(holder_secret: Field) -> Field {
    Poseidon2::hash([DOMAIN_HOLDER, holder_secret], 2)
}

pub fn compute_root(amounts: [u32; N], categories: [u32; N], days: [u32; N], blind: Field, holder_commit: Field) -> Field {
    let mut input: [Field; N + 3] = [0; N + 3];
    input[0] = DOMAIN_ROOT;
    for i in 0..N {
        input[i + 1] = pack_row(amounts[i], categories[i], days[i]);
    }
    input[N + 1] = blind;
    input[N + 2] = holder_commit;
    Poseidon2::hash(input, N + 3)
}

pub fn compute_nullifier(holder_secret: Field, campaign_id: Field) -> Field {
    Poseidon2::hash([DOMAIN_NULLIFIER, holder_secret, campaign_id], 3)
}

fn main(
    amounts: [u32; N],
    categories: [u32; N],
    days: [u32; N],
    blind: Field,
    holder_secret: Field,
    root: pub Field,
    campaign_id: pub Field,
    category: pub u32,
    day_from: pub u32,
    day_to: pub u32,
    min_cents: pub u64,
    max_cents: pub u64,
    recipient_hash: pub Field,
    nullifier: pub Field,
) {
    // Campaign parameter sanity (also enforced by the verifier).
    assert(category != 0, "padding category cannot be targeted");
    assert(category <= MAX_CATEGORY, "unknown category");
    assert(day_from <= day_to, "empty period");
    assert(min_cents <= max_cents, "empty range");
    assert(recipient_hash != 0, "recipient binding required");

    // 1. Records reproduce the issuer-signed root.
    let mut sum: u64 = 0;
    for i in 0..N {
        assert(categories[i] <= MAX_CATEGORY, "row category out of registry");
        if categories[i] == 0 {
            // Deterministic padding: padding rows carry no value.
            assert(amounts[i] == 0, "padding row with amount");
            assert(days[i] == 0, "padding row with day");
        }
        // 2. Only matching rows contribute. u32 amounts summed in u64: max 64 * 2^32 < 2^38, no overflow.
        let matches = (categories[i] == category) & (days[i] >= day_from) & (days[i] <= day_to);
        if matches {
            sum += amounts[i] as u64;
        }
    }
    let commit = holder_commitment(holder_secret);
    assert(compute_root(amounts, categories, days, blind, commit) == root, "root mismatch");

    // 3. Predicate. Only qualifying participants can produce a proof at all.
    assert(sum >= min_cents, "below minimum");
    assert(sum <= max_cents, "above maximum");

    // 4. Campaign-scoped nullifier.
    assert(compute_nullifier(holder_secret, campaign_id) == nullifier, "nullifier mismatch");
}

// Helper entry for test vectors: print values used by the JS parity test.
#[test]
fn vector_holder_and_nullifier() {
    let c = holder_commitment(12345);
    let n = compute_nullifier(12345, 777);
    std::println(c);
    std::println(n);
}
