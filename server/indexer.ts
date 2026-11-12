import { isAddress, parseEventLogs, type Address, type Hex } from 'viem'
import { escrowAbi, isRefFunded, publicClient } from './chain'
import { sql } from './db'
import { env } from './env'
import { reopenJob } from './jobState'

type Row = Record<string, unknown>
type Tx = typeof sql

/**
 * Block range per eth_getLogs call. The public Arc Testnet RPC was measured to accept 100 blocks and to
 * reject ranges of a few hundred, so start at 100 and halve on a range or rate-limit error.
 */
const START_CHUNK = 100n
const MIN_CHUNK = 10n
let chunk = START_CHUNK
/** Used only when no deployment block is configured: scan a bounded recent window, never block 0. */
const FALLBACK_LOOKBACK = 5000n

let running: Promise<void> | null = null
let lastHead = 0n
let lastError: string | null = null

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const blockTimes = new Map<bigint, number>()
async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const cached = blockTimes.get(blockNumber)
  if (cached !== undefined) return cached
  const block = await publicClient.getBlock({ blockNumber })
  const ts = Number(block.timestamp)
  if (blockTimes.size > 500) blockTimes.clear()
  blockTimes.set(blockNumber, ts)
  return ts
}

async function getState(key: string): Promise<string | null> {
  const rows = (await sql`SELECT value FROM indexer_state WHERE key = ${key}`) as Row[]
  return rows[0] ? String(rows[0].value) : null
}

async function setState(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO indexer_state (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
}

const json = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))

export async function indexerStatus() {
  if (!env.escrowAddress) return { enabled: false as const }
  const last = await getState('last_block')
  const lastBlock = last ? BigInt(last) : null
  return {
    enabled: true as const,
    lastBlock: lastBlock?.toString() ?? null,
    head: lastHead.toString(),
    blocksBehind: lastBlock !== null && lastHead > 0n ? (lastHead - lastBlock).toString() : null,
    error: lastError,
  }
}

let queued: Promise<void> | null = null

function pass(): Promise<void> {
  return runOnce()
    .then(() => {
      lastError = null
    })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error)
      console.error('Indexer pass failed:', lastError)
    })
    .finally(() => {
      running = null
    })
}

/**
 * Poll to the chain head. A caller that arrives while a pass is in flight must not reuse it: that pass
 * captured an older head and can miss the caller's transaction. It waits and then gets one fresh pass,
 * shared with any other callers that arrived in the meantime.
 */
export function syncNow(): Promise<void> {
  if (!env.escrowAddress) return Promise.resolve()
  if (!running) {
    running = pass()
    return running
  }
  if (!queued) {
    queued = running.then(() => {
      queued = null
      return syncNow()
    })
  }
  return queued
}

export function startIndexer(): void {
  if (!env.escrowAddress) {
    console.warn('VITE_ESCROW_ADDRESS is not set, so the chain indexer is disabled.')
    return
  }
  void syncNow()
  setInterval(() => void syncNow(), 5000)
}

async function runOnce(): Promise<void> {
  const address = env.escrowAddress
  if (!address) return
  lastHead = await publicClient.getBlockNumber()

  const stored = await getState('last_block')
  let last: bigint
  if (stored) {
    last = BigInt(stored)
  } else if (env.indexerStart !== undefined) {
    // A new database has nothing to rebuild, so it may start later than the deployment block. Never earlier.
    const wanted = env.indexerStart === 'latest' ? lastHead : env.indexerStart
    const floor = env.escrowDeployBlock ?? 0n
    last = (wanted > floor ? wanted : floor) - 1n
    console.warn(`Starting the chain indexer at block ${(last + 1n).toString()} (INDEXER_START_BLOCK).`)
  } else if (env.escrowDeployBlock !== undefined) {
    last = env.escrowDeployBlock - 1n
  } else {
    last = lastHead > FALLBACK_LOOKBACK ? lastHead - FALLBACK_LOOKBACK : 0n
    console.warn(`No deployment block configured; scanning only the last ${FALLBACK_LOOKBACK} blocks.`)
  }

  let throttles = 0
  while (last < lastHead) {
    const from = last + 1n
    const to = from + chunk - 1n > lastHead ? lastHead : from + chunk - 1n
    let logs: DecodedLog[]
    try {
      // Fetch by address only. The public RPC rejects event-topic filters over this contract's ten events
      // even for a handful of blocks, so decode the logs locally instead.
      const raw = await publicClient.getLogs({ address, fromBlock: from, toBlock: to })
      logs = parseEventLogs({ abi: escrowAbi, logs: raw, strict: false }) as DecodedLog[]
    } catch (error) {
      const text = error instanceof Error ? error.message.toLowerCase() : ''
      if (text.includes('too large') && chunk > MIN_CHUNK) {
        // The range itself was refused: use smaller ranges from now on.
        chunk = chunk / 2n < MIN_CHUNK ? MIN_CHUNK : chunk / 2n
        continue
      }
      if (text.includes('rate limit') || text.includes('exceeds defined limit')) {
        // Throttled, not refused: keep the same range and back off before retrying.
        throttles += 1
        if (throttles > 40) throw error
        await sleep(Math.min(250 * throttles, 3000))
        continue
      }
      throw error
    }
    throttles = 0
    logs.sort((a, b) =>
      a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : Number(a.blockNumber - b.blockNumber),
    )
    for (const log of logs) await processLog(log)
    await setState('last_block', to.toString())
    last = to
    // Stay polite to the shared public RPC while catching up after a long gap.
    if (last < lastHead) await sleep(150)
  }
  await expireAcceptances()
}

interface DecodedLog {
  eventName?: string
  args?: unknown
  blockNumber: bigint
  logIndex: number
  transactionHash: Hex
}

async function processLog(log: DecodedLog): Promise<void> {
  if (!log.eventName || !log.args) return
  const name = log.eventName
  const args = log.args as Record<string, unknown>
  const needsTime = name === 'EscrowCreated' || name === 'WorkSubmitted' || name === 'Resolved' || name === 'StaleResolved'
  const ts = needsTime ? await blockTimestamp(log.blockNumber) : 0

  await sql.begin(async (tx) => {
    const fresh = await tx`
      INSERT INTO processed_logs (tx_hash, log_index, block_number, event_name)
      VALUES (${log.transactionHash}, ${log.logIndex}, ${log.blockNumber.toString()}, ${name})
      ON CONFLICT DO NOTHING RETURNING tx_hash`
    if (fresh.length === 0) return

    switch (name) {
      case 'EscrowCreated':
        await onCreated(tx, log, args, ts)
        break
      case 'WorkSubmitted':
        await onSubmitted(tx, log, args, ts)
        break
      case 'Approved':
      case 'TimeoutClaimed':
        await settle(tx, log, args, 'released', 'completed')
        break
      case 'Cancelled':
      case 'Declined':
        await settle(tx, log, args, 'cancelled', 'cancelled')
        break
      case 'Disputed':
        await onDisputed(tx, log, args)
        break
      case 'Resolved':
      case 'StaleResolved':
        await onResolved(tx, log, args, ts, name === 'StaleResolved')
        break
      default:
        break
    }
    // Remember the latest transaction for this escrow so the UI can link to the explorer.
    if (args.escrowId !== undefined) {
      await tx`UPDATE escrows SET last_tx = ${log.transactionHash} WHERE escrow_id = ${String(args.escrowId)}`
    }
  })
}

async function anomaly(
  tx: Tx,
  log: DecodedLog,
  reason: string,
  args: Record<string, unknown>,
  jobId: string | null,
): Promise<void> {
  const client = typeof args.client === 'string' && isAddress(args.client) ? args.client.toLowerCase() : null
  const jobRef = typeof args.jobRef === 'string' ? args.jobRef : null
  console.warn(`Indexer anomaly (${reason}) in ${log.transactionHash}:${log.logIndex} for job ref ${jobRef ?? 'unknown'}`)
  await tx`
    INSERT INTO indexer_anomalies (tx_hash, log_index, job_ref, job_id, client_address, reason, raw_event)
    VALUES (${log.transactionHash}, ${log.logIndex}, ${jobRef}, ${jobId}, ${client}, ${reason}, ${json(args)}::jsonb)
    ON CONFLICT DO NOTHING`
}

/** EscrowCreated is trusted only after every field matches the accepted bid in the database. */
async function onCreated(tx: Tx, log: DecodedLog, args: Record<string, unknown>, blockTs: number): Promise<void> {
  const jobRef = String(args.jobRef)
  const client = String(args.client).toLowerCase()
  const freelancer = String(args.freelancer).toLowerCase()
  const amount = BigInt(args.amount as bigint)
  const deliveryDeadline = Number(args.deliveryDeadline)
  const reviewPeriod = Number(args.reviewPeriod)

  const refRows = (await tx`SELECT * FROM job_refs WHERE job_ref = ${jobRef}`) as Row[]
  const ref = refRows[0]
  if (!ref) return anomaly(tx, log, 'unknown_job_ref', args, null)
  const jobId = String(ref.job_id)

  const jobRows = (await tx`SELECT * FROM jobs WHERE id = ${jobId} FOR UPDATE`) as Row[]
  const job = jobRows[0]
  if (!job) return anomaly(tx, log, 'unknown_job_ref', args, null)

  if (client !== String(job.client_address)) return anomaly(tx, log, 'client_mismatch', args, jobId)
  if (job.status !== 'awaiting_funding' || job.job_ref !== jobRef || !job.accepted_bid_id) {
    return anomaly(tx, log, 'acceptance_not_active', args, jobId)
  }
  const bidRows = (await tx`SELECT * FROM bids WHERE id = ${String(job.accepted_bid_id)}`) as Row[]
  const bid = bidRows[0]
  if (!bid || bid.status !== 'accepted') return anomaly(tx, log, 'acceptance_not_active', args, jobId)
  if (freelancer !== String(bid.freelancer_address)) return anomaly(tx, log, 'freelancer_mismatch', args, jobId)
  if (amount !== BigInt(String(bid.amount))) return anomaly(tx, log, 'amount_mismatch', args, jobId)
  const existing = await tx`SELECT 1 FROM escrows WHERE job_id = ${jobId}`
  if (existing.length > 0) return anomaly(tx, log, 'duplicate_escrow', args, jobId)
  if (deliveryDeadline < blockTs + Number(bid.delivery_seconds)) return anomaly(tx, log, 'deadline_too_short', args, jobId)
  if (reviewPeriod !== Number(job.review_period_seconds)) return anomaly(tx, log, 'review_period_mismatch', args, jobId)

  await tx`
    INSERT INTO escrows (escrow_id, job_id, job_ref, client_address, freelancer_address, amount,
      delivery_deadline, review_period_seconds, created_tx, last_block)
    VALUES (${String(args.escrowId)}, ${jobId}, ${jobRef}, ${client}, ${freelancer}, ${amount.toString()},
      to_timestamp(${deliveryDeadline}), ${reviewPeriod}, ${log.transactionHash}, ${log.blockNumber.toString()})`
  await tx`UPDATE jobs SET status = 'in_escrow', updated_at = now() WHERE id = ${jobId}`
  await tx`UPDATE bids SET status = 'funded', updated_at = now() WHERE id = ${String(bid.id)}`
  await tx`UPDATE bids SET status = 'rejected', updated_at = now() WHERE job_id = ${jobId} AND status = 'open'`
}

async function findEscrow(tx: Tx, args: Record<string, unknown>): Promise<Row | null> {
  const rows = (await tx`SELECT * FROM escrows WHERE escrow_id = ${String(args.escrowId)} FOR UPDATE`) as Row[]
  return rows[0] ?? null
}

async function onSubmitted(tx: Tx, log: DecodedLog, args: Record<string, unknown>, blockTs: number): Promise<void> {
  const escrow = await findEscrow(tx, args)
  if (!escrow) return
  const jobId = String(escrow.job_id)
  const hash = String(args.deliveryHash)
  await tx`
    UPDATE escrows SET onchain_status = 'submitted', review_ends_at = to_timestamp(${Number(args.reviewEndsAt)}),
      last_block = ${log.blockNumber.toString()}, updated_at = now() WHERE escrow_id = ${String(args.escrowId)}`
  await tx`UPDATE jobs SET status = 'submitted', updated_at = now() WHERE id = ${jobId}`
  // Compare the committed hash with the stored delivery record.
  await tx`
    UPDATE deliveries SET onchain_hash = ${hash}, verified = (delivery_hash = ${hash}),
      submitted_at = to_timestamp(${blockTs}), updated_at = now() WHERE job_id = ${jobId}`
}

async function onDisputed(tx: Tx, log: DecodedLog, args: Record<string, unknown>): Promise<void> {
  const escrow = await findEscrow(tx, args)
  if (!escrow) return
  const jobId = String(escrow.job_id)
  const hash = String(args.reasonHash)
  await tx`
    UPDATE escrows SET onchain_status = 'disputed', disputed_at = to_timestamp(${Number(args.disputedAt)}),
      last_block = ${log.blockNumber.toString()}, updated_at = now() WHERE escrow_id = ${String(args.escrowId)}`
  await tx`UPDATE jobs SET status = 'disputed', updated_at = now() WHERE id = ${jobId}`
  // Compare the committed hash with the reason the client saved. A dispute opened straight on the
  // contract has no saved reason, so it is recorded with an empty one and no verdict on the hash.
  await tx`
    INSERT INTO disputes (job_id, escrow_id, reason_hash, onchain_hash, verified, status, opened_at)
    VALUES (${jobId}, ${String(args.escrowId)}, ${hash}, ${hash}, NULL, 'open', to_timestamp(${Number(args.disputedAt)}))
    ON CONFLICT (job_id) DO UPDATE
    SET onchain_hash = EXCLUDED.onchain_hash, verified = (disputes.reason_hash = EXCLUDED.onchain_hash),
        status = 'open', opened_at = EXCLUDED.opened_at, updated_at = now()`
}

async function onResolved(
  tx: Tx,
  log: DecodedLog,
  args: Record<string, unknown>,
  blockTs: number,
  stale: boolean,
): Promise<void> {
  const escrow = await findEscrow(tx, args)
  if (!escrow) return
  const jobId = String(escrow.job_id)
  await tx`
    UPDATE escrows SET onchain_status = 'resolved', last_block = ${log.blockNumber.toString()}, updated_at = now()
    WHERE escrow_id = ${String(args.escrowId)}`
  await tx`UPDATE jobs SET status = 'completed', updated_at = now() WHERE id = ${jobId}`
  const freelancerAmount = stale ? BigInt(args.amount as bigint) : BigInt(args.freelancerAmount as bigint)
  const clientAmount = stale ? 0n : BigInt(args.clientAmount as bigint)
  await tx`
    UPDATE disputes SET status = 'resolved', resolution = ${stale ? 'stale' : 'arbiter'},
      freelancer_amount = ${freelancerAmount.toString()}, client_amount = ${clientAmount.toString()},
      resolved_at = to_timestamp(${blockTs}), updated_at = now()
    WHERE job_id = ${jobId}`
}

async function settle(
  tx: Tx,
  log: DecodedLog,
  args: Record<string, unknown>,
  escrowStatus: string,
  jobStatus: string,
): Promise<void> {
  const escrow = await findEscrow(tx, args)
  if (!escrow) return
  await tx`
    UPDATE escrows SET onchain_status = ${escrowStatus}, last_block = ${log.blockNumber.toString()}, updated_at = now()
    WHERE escrow_id = ${String(args.escrowId)}`
  await tx`UPDATE jobs SET status = ${jobStatus}, updated_at = now() WHERE id = ${String(escrow.job_id)}`
}

/** Unfunded acceptances lapse after the funding window so a freelancer is never held indefinitely. */
async function expireAcceptances(): Promise<void> {
  const rows = (await sql`
    SELECT id, client_address, job_ref FROM jobs
    WHERE status = 'awaiting_funding' AND funding_expires_at < now()`) as Row[]
  for (const row of rows) {
    // If the funding transaction landed but is not indexed yet, leave the job alone.
    const funded = row.job_ref ? await isRefFunded(String(row.client_address) as Address, String(row.job_ref) as Hex) : false
    if (!funded) await reopenJob(String(row.id))
  }
}
