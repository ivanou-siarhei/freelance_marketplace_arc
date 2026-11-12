# ArcWork

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory**: what Arc Studio remembers about building this app.

---

## What This App Does

A Freelancer-style marketplace on Arc Testnet. Clients post jobs, freelancers bid, the client accepts a bid and funds a USDC escrow, the freelancer delivers, and payment is released on approval or after a review timeout. All payouts are pull payments (withdraw from the contract). Testnet only.

## Status

- Milestone 1 (contract, backend, core UI): built and reviewed.
- Milestone 2 (dispute UI, `disputes` table and routes, arbiter panel, polish): built. The contract was not changed in Milestone 2.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, SCSS modules (Tailwind removed on purpose), React Router
- Web3: wagmi v2, viem v2, ConnectKit (injected wallet)
- Contracts: Solidity 0.8.28 + Foundry. `contracts/JobEscrow.sol`, tests in `contracts/test/` (unit, boundary, fuzz, invariant, permit)
- Backend: Bun HTTP server in `server/` (port 8787), Postgres 18 in Docker (`compose.yaml`, volume mounted at `/var/lib/postgresql`)
- Chain: Arc Testnet (5042002). Token: USDC at `0x3600000000000000000000000000000000000000` (6 decimals)

## Deployed contracts (Arc Testnet)

- `JobEscrow`: `0x0e92db9a92b8bc43240e72c088defbb3e03fba78`
  - Constructor: USDC, arbiter `0x791b14D42ADc5489e8aB7e34617B2f9469C77C0c`, arbiterTimeout 600s, minDeliveryPeriod 300s, minReviewPeriod 120s (demo profile). Not upgradeable; a different profile means redeploying.
  - The ABI used by the app is `src/lib/JobEscrow.abi.json` (regenerate from `contracts/out` after any contract change).

## Key Decisions

- Cancel: the client can cancel only strictly after `deliveryDeadline` with no submission; the freelancer can `decline` any time before submitting.
- Dispute only while `now < reviewEndsAt`; `claimAfterTimeout` only when `now >= reviewEndsAt`; `resolveStale` pays 100% to the freelancer after `arbiterTimeout`.
- Funding uniqueness is keyed on `(client, jobRef)`. `jobRef = keccak256(abi.encode(jobId, bidId, client, freelancer, amount))` (see `src/lib/jobRef.ts`), recomputed in the browser before funding and by the indexer.
- The indexer (`server/indexer.ts`) marks a job `in_escrow` only after `EscrowCreated` matches the accepted bid; mismatches go to `indexer_anomalies`.
- Funding uses EIP-2612 permit (`createEscrowWithPermit`) in one transaction; the UI falls back to approve + create. Arc USDC supports permit (name "USDC", version "2").
- Sign-in is SIWE. The domain allowlist is `SIWE_ALLOWED_DOMAINS` on the server only, never taken from request headers.
- `bun run typecheck` checks the web app and `server/` separately (`server/tsconfig.json` uses Bun types).

- Disputes: the client saves a reason and evidence link (`POST /jobs/:id/dispute`), the server returns `reasonHash` (`src/lib/dispute.ts`), the client commits it with `dispute(escrowId, reasonHash)`. The indexer compares the onchain hash with the saved record. A dispute opened directly on the contract is stored with an empty reason.
- Dispute data is visible only to the client, the freelancer and the current arbiter. `GET /disputes` is arbiter-only; the arbiter is read from the contract each time.
- The public Arc RPC rejects event-topic filters over this contract's events and throttles `eth_getLogs`, so the indexer fetches by address in 100-block chunks and decodes locally. After a long sandbox pause it needs time to catch up; the UI shows a banner until it does. Do not claim the indexer is current while `blocksBehind` is large.
- A throwaway second `JobEscrow` instance was deployed to test the arbiter flow with a key the agent controlled. It is not used by the app.

- Hosting: a Vercel-style static deploy only covers the web app. The API (Bun, indexer inside) needs a long-running host and a hosted Postgres; see `DEPLOY.md`, `Dockerfile`, `.env.example`. The API accepts cross-site calls only from `CORS_ALLOWED_ORIGINS`; sign-in only from `SIWE_ALLOWED_DOMAINS`. The web app reads `VITE_API_BASE_URL` at build time.
- Do not deploy the web app to a public host before the API has a public address; the deployed site would have nothing to talk to.

## Key Files

- `server/` - API, auth, indexer, routes
- `src/pages/`, `src/components/`, `src/hooks/` - UI
- `src/styles/` - SCSS tokens, mixins, global styles, shared `ui.module.scss`
- `contracts/JobEscrow.sol` and `contracts/test/`

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query. Session tokens travel in the `Authorization` header.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
docker compose up -d --wait
bun run dev:server &
bun run dev
```
