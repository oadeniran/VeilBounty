// Words the interface uses for verifier reason codes and campaign values. Reason codes come from
// src/server/verifier.js and src/shared/*; anything unknown is shown with its code so nothing is hidden.
import { formatCents, isoFromDayIndex, dayIndexFromISO } from '../../../src/shared/encoding.js';

const REASONS = {
  already_claimed: 'This statement has already been used for this campaign. Each statement can claim once.',
  recipient_mismatch: 'The payout address does not match the one bound into the proof.',
  proof_invalid: 'The proof did not verify.',
  credential_bad_signature: "The credential is not signed by this campaign's issuer.",
  credential_expired: 'The statement has expired. Get a new one from Mock Grocer.',
  credential_malformed: 'The credential is malformed.',
  issuer_untrusted: 'The credential comes from an issuer this campaign does not trust.',
  issuer_not_in_campaign: 'The credential comes from an issuer this campaign does not use.',
  campaign_expired: 'This campaign has ended.',
  campaign_full: 'This campaign has reached its participant limit.',
  unknown_campaign: 'The claim names a different campaign.',
  consent_missing: 'No consent receipt was attached.',
  consent_bad_signature: 'The consent receipt signature is invalid.',
  consent_stale: 'The consent receipt is too old. Approve again.',
  statement_does_not_match_signature: "The edited records no longer match Mock Grocer's signature, so no proof can be made.",
  does_not_qualify: "Your records don't meet this campaign's rule, so no proof can be made.",
  witness_failed: 'The prover could not build a witness from these records.',
  prover_files_missing: "The prover's public parameters are not installed on this server. Run npm run setup.",
  verifier_unavailable: "The verifier's proving parameters are not installed. Run npm run setup on the server.",
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  network_error: 'The request did not reach the server. Check the connection and try again.',
  bad_address: 'That payout address cannot be used.',
};

export function explain(reason) {
  if (!reason) return 'Rejected.';
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith('consent_mismatch')) return 'The consent receipt does not match this claim.';
  if (reason.startsWith('public_input_mismatch')) return 'The proof was made for different campaign terms.';
  if (reason.startsWith('bad_request')) return 'The verifier refused a malformed claim.';
  if (/^http_5/.test(reason)) return 'The server had a problem. Try again in a moment.';
  return `Rejected (${reason}).`;
}

// Prover-side failures are not verifier rejections; word them as such.
export function explainProof(code) {
  return REASONS[code] ?? `The prover stopped before finishing (${String(code).slice(0, 80)}).`;
}

// Short label for logs and the security-lab table.
export const REASON_SHORT = {
  already_claimed: 'Claim tag already used', recipient_mismatch: 'Payout address mismatch',
  statement_does_not_match_signature: 'Signature mismatch', proof_invalid: 'Proof invalid',
};

const CATEGORY_ADJ = { groceries: 'Grocery', dining: 'Dining', transport: 'Transport', utilities: 'Utilities', entertainment: 'Entertainment', health: 'Health', rent: 'Rent', other: 'Other' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));

export const dollars = (cents) => `$${Number(formatCents(cents)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// "$200" when whole, "$200.50" otherwise
export const dollarsShort = (cents) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : dollars(cents));
export const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function shortDate(iso) { const [, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}`; }
export function longDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; }

// Campaign vocabulary derived from the manifest, so the UI follows campaign.json rather than hard-coded copy.
export function campaignWords(info) {
  const m = info.manifest; const p = info.params;
  const [fy, fm, fd] = m.period.from.split('-').map(Number);
  const [ty, tm, td] = m.period.to.split('-').map(Number);
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const wholeMonth = fy === ty && fm === tm && fd === 1 && td === lastDay;
  const month = wholeMonth ? MONTHS[fm - 1] : null;
  const period = fy === ty && fm === tm ? `${MONTHS[fm - 1]} ${fd}–${td}, ${fy}` : `${longDate(m.period.from)} – ${longDate(m.period.to)}`;
  const range = `${dollarsShort(p.min_cents)}–${dollarsShort(p.max_cents)}`;
  const category = m.category;
  const buyer = m.buyer.name.replace(/\s*\(demo buyer\)\s*$/i, '');
  return {
    month, period, range, category, buyer,
    buyerFull: m.buyer.name,
    title: month ? `${CATEGORY_ADJ[category] ?? capital(category)} spend, ${month} ${fy}` : `${CATEGORY_ADJ[category] ?? capital(category)} spend, ${period}`,
    adj: (CATEGORY_ADJ[category] ?? category).toLowerCase(),
    periodShort: month ?? period,
    question: `Did you spend ${range} on ${category}${month ? ` in ${month}` : ` between ${period}`}?`,
    reward: m.reward_display.replace(/\s*\(testnet ZEC\)\s*$/i, ''),
    rewardNote: /testnet/i.test(m.reward_display) ? 'testnet ZEC equivalent' : '',
    retention: `${m.retention_days} days`,
    purpose: m.purpose.split('. ')[0].replace(/\.$/, ''),
    purposeFull: m.purpose,
    issuerName: m.issuer_id === 'mock-grocer-1' ? 'Mock Grocer' : m.issuer_id,
    expires: longDate(m.expires),
    dayFrom: p.day_from, dayTo: p.day_to,
  };
}

export function inPeriod(iso, info) {
  const d = dayIndexFromISO(iso);
  return d >= info.params.day_from && d <= info.params.day_to;
}

export { isoFromDayIndex, formatCents };
