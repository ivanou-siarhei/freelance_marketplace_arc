import { SQL } from 'bun'
import { env } from './env'

export const sql = new SQL(env.databaseUrl)

/** Idempotent schema. Money is stored as raw USDC base units (6 decimals) in numeric(38,0). */
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    address text PRIMARY KEY,
    display_name text NOT NULL DEFAULT '',
    bio text NOT NULL DEFAULT '',
    skills text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_address text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    budget_min numeric(38,0) NOT NULL,
    budget_max numeric(38,0) NOT NULL,
    deadline timestamptz,
    review_period_seconds integer NOT NULL,
    status text NOT NULL DEFAULT 'open',
    accepted_bid_id uuid,
    accepted_at timestamptz,
    funding_expires_at timestamptz,
    job_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS jobs_client_idx ON jobs (client_address)`,
  `CREATE TABLE IF NOT EXISTS bids (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    freelancer_address text NOT NULL,
    amount numeric(38,0) NOT NULL,
    delivery_seconds integer NOT NULL,
    proposal text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, freelancer_address)
  )`,
  `CREATE INDEX IF NOT EXISTS bids_freelancer_idx ON bids (freelancer_address)`,
  `CREATE TABLE IF NOT EXISTS job_refs (
    job_ref text PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    bid_id uuid NOT NULL,
    client_address text NOT NULL,
    freelancer_address text NOT NULL,
    amount numeric(38,0) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS escrows (
    escrow_id numeric(38,0) PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    job_ref text NOT NULL,
    client_address text NOT NULL,
    freelancer_address text NOT NULL,
    amount numeric(38,0) NOT NULL,
    delivery_deadline timestamptz NOT NULL,
    review_period_seconds integer NOT NULL,
    onchain_status text NOT NULL DEFAULT 'funded',
    review_ends_at timestamptz,
    disputed_at timestamptz,
    created_tx text NOT NULL,
    last_block numeric(38,0) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE escrows ADD COLUMN IF NOT EXISTS last_tx text`,
  `CREATE TABLE IF NOT EXISTS disputes (
    job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    escrow_id numeric(38,0) NOT NULL,
    reason text NOT NULL DEFAULT '',
    evidence_link text NOT NULL DEFAULT '',
    canonical text NOT NULL DEFAULT '',
    reason_hash text NOT NULL,
    onchain_hash text,
    verified boolean,
    status text NOT NULL DEFAULT 'prepared',
    opened_at timestamptz,
    freelancer_response text NOT NULL DEFAULT '',
    freelancer_evidence_link text NOT NULL DEFAULT '',
    responded_at timestamptz,
    resolution text,
    freelancer_amount numeric(38,0),
    client_amount numeric(38,0),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes (status, opened_at DESC)`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    escrow_id numeric(38,0) NOT NULL,
    note text NOT NULL,
    link text NOT NULL,
    canonical text NOT NULL,
    delivery_hash text NOT NULL,
    onchain_hash text,
    verified boolean,
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS indexer_anomalies (
    id bigserial PRIMARY KEY,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    job_ref text,
    job_id uuid,
    client_address text,
    reason text NOT NULL,
    raw_event jsonb NOT NULL,
    seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tx_hash, log_index, reason)
  )`,
  `CREATE INDEX IF NOT EXISTS anomalies_client_idx ON indexer_anomalies (client_address)`,
  `CREATE TABLE IF NOT EXISTS processed_logs (
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number numeric(38,0) NOT NULL,
    event_name text NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE TABLE IF NOT EXISTS indexer_state (
    key text PRIMARY KEY,
    value text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nonces (
    nonce text PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    used boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    address text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
]

export async function migrate(): Promise<void> {
  for (const statement of STATEMENTS) {
    await sql.unsafe(statement)
  }
}
