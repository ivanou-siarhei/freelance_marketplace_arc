import type { Address } from 'viem'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

// 'latest' starts a brand-new database at the current chain head instead of scanning from the deployment block.
const indexerStartRaw = process.env.INDEXER_START_BLOCK
const escrowAddress = process.env.VITE_ESCROW_ADDRESS
const deployBlock = process.env.VITE_ESCROW_DEPLOY_BLOCK

export const env = {
  /** Arc Testnet. The whole app is testnet only. */
  chainId: 5042002,
  /** Bind address. 127.0.0.1 locally; set API_HOST=0.0.0.0 inside a container or on a hosting platform. */
  host: process.env.API_HOST || '127.0.0.1',
  /** API_PORT, or PORT (set by most hosting platforms). */
  port: num(process.env.API_PORT ? 'API_PORT' : 'PORT', 8787),
  /** Browser origins allowed to call this API from another site, for example https://app.example.com. Exact match only. */
  corsOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean),
  databaseUrl: required('DATABASE_URL'),
  /** Server-side SIWE domain allowlist. Never derived from request headers. */
  allowedDomains: (process.env.SIWE_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
  sessionTtlMs: num('SESSION_TTL_HOURS', 24) * 3_600_000,
  fundingWindowMs: num('ACCEPT_FUNDING_WINDOW_HOURS', 48) * 3_600_000,
  nonceTtlMs: 5 * 60_000,
  /** Set after the contract is deployed. */
  escrowAddress: (escrowAddress && /^0x[0-9a-fA-F]{40}$/.test(escrowAddress)
    ? (escrowAddress.toLowerCase() as Address)
    : undefined) as Address | undefined,
  indexerStart: (indexerStartRaw === 'latest' ? 'latest' : indexerStartRaw && /^\d+$/.test(indexerStartRaw) ? BigInt(indexerStartRaw) : undefined) as
    | 'latest'
    | bigint
    | undefined,
  escrowDeployBlock: deployBlock && /^\d+$/.test(deployBlock) ? BigInt(deployBlock) : undefined,
}
