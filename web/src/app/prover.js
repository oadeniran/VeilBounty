// RPC to the prover Web Worker. Private values stay in the worker; only public values come back.
import { recordWorker } from './net.js';

const worker = new Worker(new URL('../prover.worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();
const phaseListeners = new Set();

worker.onmessage = ({ data }) => {
  if (data.type === 'net') { recordWorker(data.entry); return; }
  if (data.type === 'phase') { for (const fn of phaseListeners) fn(data.phase); return; }
  const p = pending.get(data.id); if (!p) return;
  pending.delete(data.id);
  data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
};
worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker_error')); pending.clear(); };

export function call(op, args) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, op, args }); });
}
export function onPhase(fn) { phaseListeners.add(fn); return () => phaseListeners.delete(fn); }
