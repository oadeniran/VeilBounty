// Payout adapters. Spike result (see docs/ZCASH_STATUS.md): no Ironwood-capable wallet + funded testnet account was
// available in the build environment, so the default adapter is SIMULATED and never fabricates a transaction id.
import { isShieldedAddress } from '../shared/encoding.js';

export class SimulatedPayoutAdapter {
  name = 'simulated';
  describe() { return { name: this.name, real: false, label: 'Simulated payout — no Zcash transaction is broadcast' }; }
  async pay({ address }) {
    if (!isShieldedAddress(address)) return { status: 'failed', detail: 'recipient is not a shielded address' };
    return { status: 'simulated', detail: 'Simulated payout. No transaction was broadcast and no funds moved.' };
  }
}

// Manual: the operator sends from their own Ironwood-capable testnet wallet and records the txid via the operator CLI.
// The app cannot verify it on-chain, so the status is always "operator_reported", never "confirmed".
export class ManualPayoutAdapter {
  name = 'manual';
  describe() { return { name: this.name, real: true, label: 'Operator sends manually from a testnet wallet and reports the transaction id' }; }
  async pay({ address }) {
    if (!isShieldedAddress(address)) return { status: 'failed', detail: 'recipient is not a shielded address' };
    return { status: 'queued', detail: 'Waiting for the operator to send from their wallet.', keepAddress: true };
  }
}

// Sends are performed by the separately scaled keeper process, never in the claim HTTP request.
export class ZecdPayoutAdapter {
  name = 'zecd';
  describe() { return { name: this.name, real: true, label: 'Automated Zcash testnet payout via funded zecd wallet' }; }
  async pay({ address }) {
    if (!isShieldedAddress(address)) return { status: 'failed', detail: 'recipient is not a shielded address' };
    return { status: 'queued', detail: 'Waiting for the Zcash keeper to send.', keepAddress: true };
  }
  async rpc(method, params, id = method) {
    const endpoint = process.env.ZECD_RPC_URL ?? 'http://127.0.0.1:18232/';
    const user = process.env.ZECD_RPC_USER, password = process.env.ZECD_RPC_PASSWORD;
    if (!user || !password) throw Object.assign(new Error('wallet RPC credentials are not configured'), { definite: true });
    const remote = new URL(endpoint);
    if (remote.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(remote.hostname)) {
      throw Object.assign(new Error('remote wallet RPC must use HTTPS'), { definite: true });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.ZECD_RPC_TIMEOUT_MS ?? 120_000));
    try {
      const response = await fetch(endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '1.0', id, method, params }),
      });
      let body;
      try { body = await response.json(); }
      catch { throw Object.assign(new Error(`wallet RPC HTTP ${response.status} without a JSON response`), { uncertain: method === 'sendtoaddress' }); }
      if (body.error) {
        const message = String(body.error.message ?? 'request rejected').replace(/(?:utest1|ztestsapling1|tm|t2)[a-z0-9]+/gi, '[address]').slice(0, 180);
        throw Object.assign(new Error(`wallet RPC error ${body.error.code ?? ''}: ${message}`), { definite: true, rpcCode: body.error.code });
      }
      if (!response.ok) throw Object.assign(new Error(`wallet RPC HTTP ${response.status}`), { uncertain: method === 'sendtoaddress' });
      return body.result;
    } catch (e) {
      if (e.definite || e.uncertain) throw e;
      throw Object.assign(new Error(method === 'sendtoaddress' ? 'wallet send outcome is unknown; reconcile before retrying' : 'wallet RPC unavailable'), { uncertain: method === 'sendtoaddress' });
    } finally { clearTimeout(timer); }
  }
  async broadcast({ address, amountZat, claimId }) {
    try {
      const result = await this.rpc('sendtoaddress', [address, amountZat / 1e8, '', '', null, null, null, null, null, null, null, Buffer.from(`veilbounty:${claimId}`).toString('hex')], claimId);
      const txid = typeof result === 'string' ? result : result?.txid;
      if (!/^[0-9a-f]{64}$/i.test(txid ?? '')) throw Object.assign(new Error('wallet returned no valid transaction id; reconcile before retrying'), { uncertain: true });
      return txid.toLowerCase();
    } catch (e) {
      if (e.definite) throw e;
      if (e.uncertain) throw e;
      throw Object.assign(new Error('wallet send outcome is unknown; reconcile before retrying'), { uncertain: true });
    }
  }
  async getConfirmations(txid) {
    try {
      const result = await this.rpc('gettransaction', [txid], `confirm-${txid.slice(0, 8)}`);
      return Number.isInteger(result?.confirmations) ? result.confirmations : null;
    } catch (e) { if (e.rpcCode === -5) return null; throw e; }
  }
}

export function makePayoutAdapter(name = process.env.PAYOUT_ADAPTER ?? 'simulated') {
  if (name === 'simulated') return new SimulatedPayoutAdapter();
  if (name === 'manual') return new ManualPayoutAdapter();
  if (name === 'zecd') return new ZecdPayoutAdapter();
  throw new Error(`unknown PAYOUT_ADAPTER "${name}" (supported: simulated, manual, zecd)`);
}
