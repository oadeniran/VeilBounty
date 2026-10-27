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

export function makePayoutAdapter(name = process.env.PAYOUT_ADAPTER ?? 'simulated') {
  if (name === 'simulated') return new SimulatedPayoutAdapter();
  if (name === 'manual') return new ManualPayoutAdapter();
  throw new Error(`unknown PAYOUT_ADAPTER "${name}" (supported: simulated, manual)`);
}
