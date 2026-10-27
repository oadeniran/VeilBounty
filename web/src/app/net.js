// Every request the page and its prover worker make goes through here and lands in the audit log.
// The log is what the History view, the header chip and the browser privacy test read.
//
// Leak scan: once the statement is on this device, its private values (row dates, dollar amounts, merchants,
// the campaign total, the issuer blind) are registered here. Every outgoing body is searched for them before it is
// sent, so "0 B of records sent" is measured on the actual bytes, not asserted.
// Short integers (cents) are not scanned: four-digit strings occur by chance inside base64 proofs.

const listeners = new Set();
export const netlog = [];
let privateValues = []; // [{ value, kind, row? }]

export function onNet(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { for (const fn of listeners) fn(netlog); };

export function registerPrivateValues(values) {
  const seen = new Set(privateValues.map((p) => p.value));
  for (const v of values) if (v.value && v.value.length >= 5 && !seen.has(v.value)) { privateValues.push(v); seen.add(v.value); }
}

export function scanForPrivate(body) {
  if (!body) return [];
  return privateValues.filter((p) => body.includes(p.value));
}

// Number of distinct statement rows any of whose values appeared in an outgoing request body.
export function privateRowsSent() {
  const rows = new Set();
  for (const e of netlog) for (const l of e.leaks) if (l.row != null) rows.add(l.row);
  return rows.size;
}
export function privateBytesSent() {
  return netlog.reduce((n, e) => n + e.leaks.reduce((m, l) => m + l.value.length, 0), 0);
}

// purpose: human description shown in the audit. carries: what the request body contains, in words.
export function record({ from = 'page', method, path, sent = 0, received = null, purpose, carries, status = null, body = '' }) {
  const entry = { n: netlog.length + 1, at: Date.now(), from, method, path, sent, received, purpose, carries, status, leaks: scanForPrivate(body) };
  netlog.push(entry); emit();
  return entry;
}

export async function api(method, path, body, { purpose, carries } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const entry = record({ method, path, sent: payload ? new TextEncoder().encode(payload).length : 0, purpose, carries: carries ?? (payload ? '' : 'Nothing (download)'), body: payload });
  let r;
  try {
    r = await fetch(path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload, cache: 'no-store' });
  } catch (e) {
    entry.status = 'network error'; emit();
    throw Object.assign(new Error('network_error'), { cause: e });
  }
  const text = await r.text();
  entry.status = r.status; entry.received = new TextEncoder().encode(text).length; emit();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: r.status, body: json };
}

// Worker requests are reported by the worker's fetch hook (method, path, bytes sent).
export function recordWorker(entry) {
  const p = entry.url;
  const purpose = p.startsWith('/crs/') ? 'Public proving parameters' : p.startsWith('/bb/') ? 'Prover engine (Barretenberg)' : 'Prover code';
  return record({ from: 'prover worker', method: entry.method, path: p, sent: entry.bytesSent, received: entry.received ?? null, purpose, carries: 'Nothing (public prover file)', status: entry.status ?? null });
}
