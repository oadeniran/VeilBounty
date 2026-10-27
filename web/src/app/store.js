// Single in-memory state object for the demo page. Nothing here is persisted: closing the tab discards the
// statement, the claim and the history, which is the privacy property the page describes.

export const STEPS = ['Campaign', 'Statement', 'Consent', 'Proof', 'Verify', 'Reward'];
export const STAGE = { campaign: 0, statement: 1, consent: 2, proof: 3, verify: 4, reward: 5 };

export const S = {
  info: null,          // GET /api/campaign
  words: null,         // campaignWords(info)
  view: 'claim',       // claim | lab | history
  stage: 0,
  statement: freshStatement(),
  consent: { addr: '', checked: false, prepared: null, error: null },
  proof: freshProof(),
  claim: null,         // the object POSTed to /api/claims
  submit: { status: 'idle', reason: null, response: null, at: null },
  payout: null,
  lab: freshLab(),
  history: [],         // participation entries, newest first
  proverInit: 'pending', // pending | ready | failed
  proverError: null,
};

export function freshStatement() {
  return { status: 'empty', issued: null, records: [], counted: [], total: 0, sigError: null, rootOk: false, qualifies: false, error: null, expiresDay: null };
}
export function freshProof() {
  return { status: 'idle', phase: null, startedAt: 0, ms: 0, bytes: 0, error: null, netFrom: 0, netNote: '' };
}
export function freshLab() {
  return {
    tamper: { st: 'idle', result: null },
    replay: { st: 'idle', result: null },
    redirect: { st: 'idle', result: null },
  };
}

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function changed(what = 'all') { for (const fn of subs) fn(what); }

export function addHistory(entry) { S.history.unshift({ at: Date.now(), ...entry }); changed('history'); }
