import { canonicalDelivery, hashDelivery } from '../../src/lib/delivery'
import { sql } from '../db'
import { HttpError, requireAddress, route, str, uuid } from '../http'
import { mapDelivery, mapEscrow } from '../serialize'

type Row = Record<string, unknown>

function deliveryLink(value: unknown): string {
  const link = str(value, 'Link', 4, 500)
  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    throw new HttpError(400, 'Link must be a full URL')
  }
  if (!['https:', 'http:', 'ipfs:'].includes(parsed.protocol)) throw new HttpError(400, 'Link must start with https:// or ipfs://')
  return link
}

export function registerEscrowRoutes(): void {
  // Escrows where you are the client or the freelancer, with the job title for display.
  route(
    'GET',
    '/me/escrows',
    async (ctx) => {
      const me = requireAddress(ctx)
      const rows = (await sql`
        SELECT e.*, j.title AS job_title FROM escrows e JOIN jobs j ON j.id = e.job_id
        WHERE e.client_address = ${me} OR e.freelancer_address = ${me}
        ORDER BY e.created_at DESC LIMIT 100`) as Row[]
      return { escrows: rows.map((row) => ({ ...mapEscrow(row), jobTitle: String(row.job_title) })) }
    },
    { auth: true },
  )

  // Escrows funded by you that did not match an accepted bid. Shown as an "unmatched escrow" notice.
  route(
    'GET',
    '/me/anomalies',
    async (ctx) => {
      const me = requireAddress(ctx)
      const rows = (await sql`
        SELECT a.tx_hash, a.job_ref, a.job_id, a.reason, a.seen_at, a.raw_event, j.title AS job_title
        FROM indexer_anomalies a LEFT JOIN jobs j ON j.id = a.job_id
        WHERE a.client_address = ${me} ORDER BY a.seen_at DESC LIMIT 20`) as Row[]
      return {
        anomalies: rows.map((row) => ({
          txHash: String(row.tx_hash),
          jobRef: row.job_ref ? String(row.job_ref) : null,
          jobId: row.job_id ? String(row.job_id) : null,
          jobTitle: row.job_title ? String(row.job_title) : null,
          reason: String(row.reason),
          seenAt: row.seen_at instanceof Date ? row.seen_at.toISOString() : null,
        })),
      }
    },
    { auth: true },
  )

  // The freelancer prepares the delivery record. The server returns the hash to commit with submitWork.
  route(
    'POST',
    '/jobs/:id/delivery',
    async (ctx) => {
      const me = requireAddress(ctx)
      const jobId = uuid(ctx.params.id ?? '')
      const body = await ctx.json()
      const note = str(body.note, 'Delivery note', 5, 3000)
      const link = deliveryLink(body.link)

      const rows = (await sql`SELECT * FROM escrows WHERE job_id = ${jobId}`) as Row[]
      const escrow = rows[0]
      if (!escrow) throw new HttpError(409, 'This job has no funded escrow yet')
      if (escrow.freelancer_address !== me) throw new HttpError(403, 'Only the hired freelancer can deliver work')
      if (escrow.onchain_status !== 'funded') throw new HttpError(409, 'Work has already been submitted for this job')

      const record = { jobId, escrowId: String(escrow.escrow_id), note, link }
      const canonical = canonicalDelivery(record)
      const deliveryHash = hashDelivery(record)
      const saved = await sql`
        INSERT INTO deliveries (job_id, escrow_id, note, link, canonical, delivery_hash)
        VALUES (${jobId}, ${String(escrow.escrow_id)}, ${note}, ${link}, ${canonical}, ${deliveryHash})
        ON CONFLICT (job_id) DO UPDATE
        SET note = EXCLUDED.note, link = EXCLUDED.link, canonical = EXCLUDED.canonical,
            delivery_hash = EXCLUDED.delivery_hash, updated_at = now()
        WHERE deliveries.submitted_at IS NULL
        RETURNING *`
      const row = saved[0] as Row | undefined
      if (!row) throw new HttpError(409, 'Work has already been submitted for this job')
      return mapDelivery(row)
    },
    { auth: true },
  )
}
