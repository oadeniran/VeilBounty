# Deployment runbook

This runbook deploys the current repository to Heroku with real Zcash **testnet** payouts. It assumes the app source has the `web` and `worker` process types in the root `Procfile`.

## What runs where

```text
Participant ──HTTPS──> Heroku web ──> MongoDB Atlas
                                 payout queue ▲
Heroku worker ────────────────────────────────┘
       │ HTTPS JSON-RPC
       ▼
Funded zecd testnet wallet ──> testnet backend (zecrocks lightwalletd or Zebra)
```

- **Heroku `web`** serves the participant app, verifies claims, and stores queued payouts.
- **Heroku `worker`** reads the same durable queue, submits wallet sends, saves txids, and tracks confirmations.
- **MongoDB Atlas** must be shared by web and worker. Heroku dynos have separate ephemeral filesystems, so SQLite is not a deployment store.
- **`zecd`** owns the spending keys and signs/broadcasts transactions. It runs separately from Heroku in this deployment. Its chain backend can be Zebra or a lightwalletd endpoint; public lightwalletd is not the wallet RPC endpoint used by the keeper.

The local `npm run start:all` command is for a local workstation only. Heroku runs the `web` and `worker` Procfile commands as separate dynos. [Heroku Procfile and process types](https://devcenter.heroku.com/articles/procfile) · [Heroku dyno filesystem](https://devcenter.heroku.com/articles/dynos#ephemeral-filesystem)

## Before deploying

1. Use an Ironwood-capable `zecd` wallet on **testnet**, connected to its chosen chain backend and funded with TAZ. The wallet host must stay online and keep its wallet data safe.
2. Ensure the wallet RPC can be reached from the Heroku worker. Use a remote **HTTPS** endpoint with a valid certificate and strong RPC credentials. This app rejects remote wallet RPC over plain HTTP. Do not expose the wallet's plaintext RPC port directly to the internet. Heroku cannot reach your workstation's `127.0.0.1`.
3. Create a MongoDB Atlas database and a database user restricted to the app database. Configure Atlas network access for the Heroku app's egress arrangement. If the selected Heroku runtime has no fixed egress IP, use an appropriate private-network or fixed-egress option, or a carefully scoped network rule; do not assume an IP allowlist entry for your laptop will work.
4. Confirm the target Heroku app is the intended app. The deployed app remains on its old version until you push this clone to the Heroku Git remote.

The wallet RPC URL is spend authority. Keep its credentials in Heroku config vars and out of source, logs, screenshots, and support messages. Heroku config vars are available to every dyno in that app and setting them restarts the app. [Heroku config vars](https://devcenter.heroku.com/articles/config-vars)

## Deploy web and worker in one Heroku app

This is the simplest topology. Wallet RPC credentials are also available to the web dyno because Heroku shares app config vars between process types.

1. In **Heroku Dashboard → Settings → Config Vars**, set sensitive values `MONGODB_URI` and `ZECD_RPC_PASSWORD` so you do not put secrets directly in shell history. URL-encode reserved characters in the MongoDB URI password. Set the remaining runtime values as shown below (or in the Dashboard).

```bash
heroku config:set -a <app-name> \
  PAYOUT_ADAPTER=zecd \
  ZECD_RPC_URL='https://<private-wallet-rpc-host>/' \
  ZECD_RPC_USER='<wallet-rpc-user>' \
  ZCASH_REQUIRED_CONFIRMATIONS=1
```

In the Dashboard, set `MONGODB_URI` to `mongodb+srv://<db-user>:<encoded-password>@<cluster>/veilbounty?retryWrites=true&w=majority` and `ZECD_RPC_PASSWORD` to the wallet RPC password. `MONGODB_DB` is optional when the URI already names the database. The worker refuses to run on Heroku without `MONGODB_URI`.

2. Push this clone to the app's Heroku remote. If the remote is already named `heroku`:

```bash
git push heroku HEAD:main
```

Heroku's Node build runs `heroku-postbuild`, which performs `npm run setup` and `npm run build:web`.

3. Start one web dyno and one keeper worker. Heroku starts the web process by default; worker process types need to be scaled explicitly.

```bash
heroku ps:scale -a <app-name> web=1 worker=1
heroku ps -a <app-name>
heroku logs --tail -a <app-name>
```

Check that the web startup log names a MongoDB store and that the worker logs `Zcash payout keeper started`. Check the participant site at `/demo`; `/api/campaign` should report the `zecd` payout adapter. Test with a small testnet reward and a wallet address you control before inviting participants.

## Isolate wallet credentials in a worker-only app

For stronger separation, use two Heroku apps deployed from the same commit:

- **Web app:** set `MONGODB_URI` and `PAYOUT_ADAPTER=zecd`; scale `web=1 worker=0`.
- **Keeper app:** set the same `MONGODB_URI` and `PAYOUT_ADAPTER=zecd`, plus `ZECD_RPC_URL`, `ZECD_RPC_USER`, and `ZECD_RPC_PASSWORD`; scale `web=0 worker=1`.

Both apps must point to the same Atlas database. Only the keeper app receives wallet RPC credentials. Deploy the same code commit to both apps so the queue schema and worker logic match.

## Local startup

Copy `.env.example` to `.env`, set the RPC password, and run `npm run init` once. Then run `npm run start:all`. The launcher starts `zecd` with the configured testnet backend, or reuses it if its loopback RPC is already answering; it verifies the reported chain before starting the web app and keeper. It never starts the wallet on mainnet. `.env` is gitignored and should remain private.

## Payout states and recovery

- `queued`: waiting for a worker.
- `sending`: worker has claimed the queue row and is calling the wallet.
- `broadcast`: txid was received; confirmations are being polled.
- `confirmed`: wallet reports the configured confirmation count.
- `failed`: wallet definitively rejected the send.
- `needs_reconciliation`: the send response was ambiguous or the worker stopped mid-send. The transaction may already exist. Inspect the wallet/chain before any manual action; the keeper will not retry this payout.

The claim page polls its payout endpoint and displays the txid and confirmation count when available. A payout can remain queued if the worker is stopped. Do not delete or reset queue records to recover a payout.

## Deployment notes

- The build generates a mock issuer key as part of `npm run setup`. A new deploy can therefore rotate that key; credentials issued by the previous release may no longer verify after a deploy. Plan deploy timing accordingly.
- Heroku config var changes restart app dynos. Change wallet endpoint or credentials only when the wallet host is ready.
- `ZECD_DATADIR`, `ZECD_BACKEND`, and related local wallet launcher settings are for `npm run start:all`; Heroku's keeper only needs the wallet RPC URL and credentials.
- `PAYOUT_ADAPTER=simulated` remains the default if the setting is absent. Keep it that way in any app where real testnet payments are not intended.
