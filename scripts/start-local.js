// Start local zecd (if needed), the web app and the keeper from the ignored .env file.
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ZecdPayoutAdapter } from '../src/server/payout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    process.env[match[1]] = value;
  }
}

const fail = (message) => { console.error(message); process.exitCode = 1; };
if (process.env.PAYOUT_ADAPTER !== 'zecd') { fail('Set PAYOUT_ADAPTER=zecd in .env to enable live testnet payouts.'); process.exit(); }
for (const key of ['ZECD_RPC_USER', 'ZECD_RPC_PASSWORD']) if (!process.env[key]) { fail(`Missing ${key} in environment or .env.`); process.exit(); }
if (!existsSync(resolve(root, 'dist/index.html')) || !existsSync(resolve(root, '.data/issuer-key.json'))) {
  fail('Local app is not initialized. Run `npm run init` first.'); process.exit();
}

const network = (process.env.ZECD_NETWORK ?? 'test').toLowerCase();
if (!['test', 'testnet'].includes(network)) { fail('ZECD_NETWORK must be test; refusing to start an automated mainnet wallet.'); process.exit(); }
const datadir = (process.env.ZECD_DATADIR ?? resolve(homedir(), '.zecd-testnet')).replace(/^~(?=\/)/, homedir());
const backend = process.env.ZECD_BACKEND ?? 'zecrocks';
const rpcBind = process.env.ZECD_RPC_BIND ?? '127.0.0.1';
const rpcPort = process.env.ZECD_RPC_PORT ?? '18232';
const rpcUser = process.env.ZECD_RPC_USER;
const rpcUrl = new URL(process.env.ZECD_RPC_URL ?? `http://${rpcBind}:${rpcPort}/`);
if (!['127.0.0.1', 'localhost', '::1'].includes(rpcUrl.hostname) || rpcUrl.port !== String(rpcPort)) {
  fail('Local start:all requires ZECD_RPC_URL to point to the configured loopback wallet RPC.'); process.exit();
}
if (!['127.0.0.1', 'localhost', '::1'].includes(rpcBind)) { fail('ZECD_RPC_BIND must be loopback for a local wallet.'); process.exit(); }

const wallet = new ZecdPayoutAdapter();
const children = new Map();
let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children.values()) if (child.exitCode == null) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children.values()) if (child.exitCode == null) child.kill('SIGKILL'); }, 8_000).unref();
}
process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));

async function walletInfo() {
  const oldTimeout = process.env.ZECD_RPC_TIMEOUT_MS;
  process.env.ZECD_RPC_TIMEOUT_MS = '4000';
  try { return await wallet.rpc('getblockchaininfo', [], 'startup-check'); }
  finally {
    if (oldTimeout === undefined) delete process.env.ZECD_RPC_TIMEOUT_MS;
    else process.env.ZECD_RPC_TIMEOUT_MS = oldTimeout;
  }
}
function checkNetwork(info) {
  if (!['test', 'testnet'].includes(info?.chain)) throw new Error(`Expected Zcash testnet, wallet reports ${info?.chain ?? 'unknown network'}.`);
}
function start(name, command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
  children.set(name, child);
  child.once('error', (error) => { console.error(`${name} process failed to start: ${error.message}`); stopAll(1); });
  child.once('exit', (code, signal) => {
    console.log(`${name} stopped (${signal ?? code ?? 'unknown'}).`);
    if (!stopping) stopAll(code || 1);
  });
  return child;
}

try {
  let info;
  try { info = await walletInfo(); }
  catch { /* no RPC yet; start zecd below */ }
  if (info) {
    checkNetwork(info);
    console.log(`Reusing the running zecd wallet on ${info.chain}.`);
  } else {
    console.log(`Starting zecd on testnet (backend ${backend}, datadir ${datadir})…`);
    const zecd = start('zecd', 'zecd', [
      '--datadir', datadir, '--testnet', '--server', backend,
      '--rpcbind', rpcBind, '--rpcport', String(rpcPort), '--rpcuser', rpcUser, 'run',
    ]);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !stopping) {
      if (zecd.exitCode != null) throw new Error(`zecd exited before its RPC became ready (exit ${zecd.exitCode}).`);
      try { info = await walletInfo(); checkNetwork(info); break; } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
    }
    if (!info) throw new Error('zecd RPC did not become ready within 120 seconds. Check its logs and testnet backend.');
    console.log(`zecd ready on ${info.chain}.`);
  }
  if (stopping) process.exit();
  console.log('Starting VeilBounty web app and keeper. Press Ctrl+C to stop.');
  start('web', process.execPath, ['--no-warnings', 'src/server/app.js']);
  start('keeper', process.execPath, ['--no-warnings', 'scripts/keeper.js']);
} catch (error) {
  fail(`Startup failed: ${error.message}`);
  stopAll(1);
}
