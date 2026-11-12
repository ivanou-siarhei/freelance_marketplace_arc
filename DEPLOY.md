# Deploying ArcWork

ArcWork has three parts, and each needs its own home:

| Part | What it is | Where it can run |
| --- | --- | --- |
| Web app | The React site (`dist/` after `bun run build`) | Vercel, Netlify, any static host |
| API | The Bun server in `server/`, with the chain indexer inside it | Any host that runs a Docker container or Bun and keeps it running (Render, Railway, Fly.io, a VPS). Not a serverless function. |
| Database | Postgres 18 | Any hosted Postgres (Neon, Supabase, Render, Railway, RDS) |

The escrow contract is already on Arc Testnet. Nothing here redeploys it.

Order matters: database, then API, then web app, then one small update to the API.

## 1. Database

Create a Postgres database and copy its connection string. Hosted databases usually need TLS, so keep `?sslmode=require` on the end if your provider gives it. The API creates its own tables on first start.

## 2. API

Deploy the `Dockerfile` at the project root (it only installs `viem`). Set these environment variables on the host:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the connection string from step 1 |
| `VITE_ESCROW_ADDRESS` | `0x0e92db9a92b8bc43240e72c088defbb3e03fba78` |
| `VITE_ESCROW_DEPLOY_BLOCK` | the block the contract was deployed in (see `contracts/contract-metadata/JobEscrow.json`, or the deploy transaction on the explorer) |
| `INDEXER_START_BLOCK` | `latest` for a brand-new database (skips scanning old blocks) |
| `SIWE_ALLOWED_DOMAINS` | the host(s) where the web app will be served, for example `arcwork.vercel.app` (fill in after step 3) |
| `CORS_ALLOWED_ORIGINS` | the web app's origin, for example `https://arcwork.vercel.app` (fill in after step 3) |
| `RPC_URL_Arc_Testnet` | recommended: your own Arc Testnet RPC URL. Without it the API uses the public RPC, which throttles log reads. |

The container listens on `PORT`/`API_PORT` (default 8787) on all interfaces. Use `GET /health` as the health check. It reports the indexer's `blocksBehind`.

Keep exactly one copy of the API running: the indexer lives inside it.

Treat `DATABASE_URL` and any RPC URL as secrets. Set them in the host's secret settings, never in the repository.

## 3. Web app

Build with the API's public address, then upload `dist/`:

```bash
VITE_API_BASE_URL=https://your-api-host bun run build
```

`public/vercel.json` is copied into `dist/` and makes links like `/jobs/…` open correctly on Vercel.

## 4. Finish the API settings

Once the web app has an address, set `SIWE_ALLOWED_DOMAINS` and `CORS_ALLOWED_ORIGINS` on the API to match it, then restart the API. Sign-in fails for any host that is not in `SIWE_ALLOWED_DOMAINS`.

If the web app later moves to a new address, update both settings and restart the API. Rebuild the web app only if the API's address changed.

## Checks after deploying

- `GET <api>/health` returns `"ok": true` and `blocksBehind` near 0.
- The site loads jobs without a red "server not reachable" banner.
- Connect a wallet, sign in, post a job.
