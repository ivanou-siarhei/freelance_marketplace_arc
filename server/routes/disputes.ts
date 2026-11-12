import { canonicalDispute, hashDispute } from '../../src/lib/dispute'
import { currentArbiter } from '../chain'
import { sql } from '../db'
import { HttpError, requireAddress, route, str, uuid } from '../http'
import { mapDelivery, mapDispute, mapEscrow } from '../serialize'

type Row = Record<string, unknown>

function optionalLink(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return ''
  const link = str(value, field, 4, 500)
  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    throw new HttpError(400, `${field} must be a full URL`)
  }
  if (!['https:', 'http:', 'ipfs:'].includes(parsed.protocol)) {
    throw new HttpError(400, `${field} must start with https:// or ipfs://`)
  }
  return link
}

export function registerDisputeRoutes(): void {
  // The client saves the reason and evidence. The server returns the hash to commit with dispute().
  route(
    'POST',
    '/jobs/:id/dispute',
    async (ctx) => {
      const me = requireAddress(ctx)
      const jobId = uuid(ctx.params.id ?? '')
      const body = await ctx.json()
      const reason = str(body.reason, 'Reason', 20, 2000)
      const evidenceLink = optionalLink(body.evidenceLink, 'Evidence link')

      const rows = (await sql`SELECT * FROM escrows WHERE job_id = ${jobId}`) as Row[]
      const escrow = rows[0]
      if (!escrow) throw new HttpError(409, 'This job has no funded escrow')
      if (escrow.client_address !== me) throw new HttpError(403, 'Only the client can open a dispute')
      if (escrow.onchain_status !== 'submitted') throw new HttpError(409, 'A dispute can only be opened after work is submitted')
      if (escrow.review_ends_at instanceof Date && escrow.review_ends_at.getTime() <= Date.now()) {
        throw new HttpError(409, 'The review window has ended, so a dispute can no longer be opened')
      }

      const record = { jobId, escrowId: String(escrow.escrow_id), reason, evidenceLink }
      const canonical = canonicalDispute(record)
      const reasonHash = hashDispute(record)
      const saved = await sql`
        INSERT INTO disputes (job_id, escrow_id, reason, evidence_link, canonical, reason_hash)
        VALUES (${jobId}, ${String(escrow.escrow_id)}, ${reason}, ${evidenceLink}, ${canonical}, ${reasonHash})
        ON CONFLICT (job_id) DO UPDATE
        SET reason = EXCLUDED.reason, evidence_link = EXCLUDED.evidence_link, canonical = EXCLUDED.canonical,
            reason_hash = EXCLUDED.reason_hash, updated_at = now()
        WHERE disputes.status = 'prepared'
        RETURNING *`
      const row = saved[0] as Row | undefined
      if (!row) throw new HttpError(409, 'A dispute is already open for this job')
      return mapDispute(row)
    },
    { auth: true },
  )

  // The freelancer answers once a dispute is open.
  route(
    'POST',
    '/jobs/:id/dispute/respond',
    async (ctx) => {
      const me = requireAddress(ctx)
      const jobId = uuid(ctx.params.id ?? '')
      const body = await ctx.json()
      const response = str(body.response, 'Response', 10, 2000)
      const evidenceLink = optionalLink(body.evidenceLink, 'Evidence link')

      const escrowRows = (await sql`SELECT freelancer_address FROM escrows WHERE job_id = ${jobId}`) as Row[]
      const escrow = escrowRows[0]
      if (!escrow) throw new HttpError(404, 'Job not found')
      if (escrow.freelancer_address !== me) throw new HttpError(403, 'Only the hired freelancer can respond')
      const updated = await sql`
        UPDATE disputes SET freelancer_response = ${response}, freelancer_evidence_link = ${evidenceLink},
          responded_at = now(), updated_at = now()
        WHERE job_id = ${jobId} AND status = 'open' RETURNING *`
      const row = updated[0] as Row | undefined
      if (!row) throw new HttpError(409, 'There is no open dispute to respond to')
      return mapDispute(row)
    },
    { auth: true },
  )

  // Everything the arbiter needs to decide. Only the contract's current arbiter can read this list.
  route(
    'GET',
    '/disputes',
    async (ctx) => {
      const me = requireAddress(ctx)
      const arbiter = await currentArbiter()
      if (!arbiter || arbiter !== me) throw new HttpError(403, 'Only the arbiter can see the dispute queue')
      const rows = (await sql`
        SELECT d.*, j.title AS job_title, j.description AS job_description,
          e.client_address, e.freelancer_address, e.amount, e.delivery_deadline, e.review_period_seconds,
          e.onchain_status, e.review_ends_at, e.disputed_at, e.created_tx, e.last_tx, e.job_ref, e.job_id AS escrow_job_id,
          dl.note AS delivery_note, dl.link AS delivery_link, dl.canonical AS delivery_canonical,
          dl.delivery_hash, dl.onchain_hash AS delivery_onchain_hash, dl.verified AS delivery_verified,
          dl.submitted_at AS delivery_submitted_at, dl.escrow_id AS delivery_escrow_id
        FROM disputes d
        JOIN escrows e ON e.job_id = d.job_id
        JOIN jobs j ON j.id = d.job_id
        LEFT JOIN deliveries dl ON dl.job_id = d.job_id
        WHERE d.status IN ('open', 'resolved')
        ORDER BY (d.status = 'open') DESC, d.opened_at DESC NULLS LAST
        LIMIT 50`) as Row[]
      return {
        disputes: rows.map((row) => ({
          dispute: mapDispute(row),
          jobTitle: String(row.job_title),
          jobDescription: String(row.job_description),
          escrow: mapEscrow({ ...row, job_id: row.escrow_job_id }),
          delivery: row.delivery_note
            ? mapDelivery({
                job_id: row.job_id,
                escrow_id: row.delivery_escrow_id,
                note: row.delivery_note,
                link: row.delivery_link,
                canonical: row.delivery_canonical,
                delivery_hash: row.delivery_hash,
                onchain_hash: row.delivery_onchain_hash,
                verified: row.delivery_verified,
                submitted_at: row.delivery_submitted_at,
              })
            : null,
        })),
      }
    },
    { auth: true },
  )

  route('GET', '/arbiter', async (ctx) => {
    const arbiter = await currentArbiter()
    return { arbiter, isArbiter: Boolean(arbiter && ctx.address && ctx.address === arbiter) }
  })
}
