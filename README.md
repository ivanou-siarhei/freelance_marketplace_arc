# ArcWork

A freelance marketplace where clients post jobs, freelancers bid, and the agreed amount is held in a USDC escrow on Arc Testnet until the work is approved, released automatically after a review window, or settled. If a client disputes the work, a separate arbiter wallet decides how the money is split.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React 18, Vite, TypeScript, SCSS modules
- wagmi, viem, ConnectKit (injected wallets), TanStack Query, React Router
- Solidity 0.8.28 escrow contract with Foundry tests
- Bun HTTP API with Postgres 18 (Docker) for jobs, bids, profiles and deliveries
- Sign-In with Ethereum (EIP-4361) for accounts

## Development

### Prerequisites

- [Bun](https://bun.sh) 1.3 or newer
- Docker (for Postgres)
- [Foundry](https://book.getfoundry.sh) (to build and test the contract)
- A browser wallet on Arc Testnet with test USDC (https://faucet.circle.com)

### Install

```bash
bun install
docker compose up -d --wait   # starts Postgres on 127.0.0.1:5432
```

### Environment variables

Set these in `.env` (never commit it):

- `DATABASE_URL`: Postgres connection string, for example `postgres://postgres:postgres@127.0.0.1:5432/arcwork`.
- `API_PORT`: port for the API (default 8787). The Vite dev server proxies `/api` to it.
- `SIWE_ALLOWED_DOMAINS`: comma-separated hosts allowed to sign in, server side only. Use exact hosts or a parent rule like `*.example.com`. Add your own host when you deploy the app elsewhere.
- `SESSION_TTL_HOURS`: sign-in session length (default 24).
- `ACCEPT_FUNDING_WINDOW_HOURS`: how long an accepted bid waits for funding before the job reopens (default 48).
- `VITE_ESCROW_ADDRESS`: deployed escrow contract address.
- `VITE_ESCROW_DEPLOY_BLOCK`: block the contract was deployed in. The chain indexer starts here.
- `CORS_ALLOWED_ORIGINS`: browser origins allowed to call the API from another site (exact addresses). Not needed when the web app uses the dev proxy.
- `API_HOST`: address the API binds to (default 127.0.0.1; use 0.0.0.0 in a container). `PORT` is also accepted for `API_PORT`.
- `INDEXER_START_BLOCK`: optional. Use `latest` for a brand-new database so the indexer skips old blocks.
- `RPC_URL_Arc_Testnet`: optional. Your own Arc Testnet RPC URL, used instead of the public one. Keep it secret.
- `VITE_API_BASE_URL`: optional, build time. Address of a separately hosted API. When absent the web app calls `/api`.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional outside Arc Studio. When absent, the API uses the public Arc Testnet RPC, which limits how fast the indexer can catch up after a long pause. The app shows a banner while it is catching up.

### Run

```bash
bun run dev:server   # API on http://127.0.0.1:8787
bun run dev          # web app on http://localhost:5173
```

`bun run dev:all` starts both.

### Build and test

```bash
bun run build            # production build of the web app
bun run check            # lint and typecheck (web app and API)
bun run contracts:build  # compile the contract
bun run contracts:test   # run the contract tests
```

## Deploying

The web app, API and database are hosted separately. See [DEPLOY.md](DEPLOY.md).

## Using the app

1. Connect a wallet on Arc Testnet and sign in.
2. Post a job with a budget and a review window.
3. Freelancers bid. Pick one with "Accept and fund" to lock the USDC in escrow.
4. The freelancer submits work. You approve it, or the payment is released when the review window ends.
5. If you disagree with the work, dispute it before the review window ends. Write what is wrong and add a link to evidence. The freelancer can answer.
6. The arbiter wallet gets an Arbiter page with every dispute, both sides of the story and the delivery, and chooses how much goes to each side. If the arbiter does not decide in time, anyone can settle it and the freelancer receives the full amount.
7. Payouts and refunds appear on the Dashboard. Use Withdraw to move them to your wallet.

Use three different wallets to try every role: client, freelancer and the arbiter.
