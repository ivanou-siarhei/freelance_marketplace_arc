import { MAX_BID_DELIVERY_SECONDS } from '../../src/lib/categories'
import { readEscrowParams } from '../chain'
import { sql } from '../db'
import { HttpError, integer, rawAmount, requireAddress, route, str, uuid } from '../http'
import { mapBid } from '../serialize'

type Row = Record<string, unknown>

export function registerBidRoutes(): void {
  // Create a bid, or edit your own open bid. An accepted bid is locked.
  route(
    'POST',
    '/jobs/:id/bids',
    async (ctx) => {
      const me = requireAddress(ctx)
      const jobId = uuid(ctx.params.id ?? '')
      const body = await ctx.json()
      const amount = rawAmount(body.amount, 'Bid amount')
      const params = await readEscrowParams().catch(() => null)
      const minDelivery = params?.minDeliveryPeriod ?? 60
      const deliverySeconds = integer(body.deliverySeconds, 'Delivery time', minDelivery, MAX_BID_DELIVERY_SECONDS)
      const proposal = str(body.proposal, 'Proposal', 10, 3000)

      const jobRows = (await sql`SELECT client_address, status, deadline FROM jobs WHERE id = ${jobId}`) as Row[]
      const job = jobRows[0]
      if (!job) throw new HttpError(404, 'Job not found')
      if (job.client_address === me) throw new HttpError(400, 'You cannot bid on your own job')
      if (job.status !== 'open' && job.status !== 'awaiting_funding') throw new HttpError(409, 'This job is not taking bids')
      if (job.deadline instanceof Date && job.deadline.getTime() < Date.now()) {
        throw new HttpError(409, 'Bidding on this job has closed')
      }

      await sql`INSERT INTO users (address) VALUES (${me}) ON CONFLICT (address) DO NOTHING`
      const existing = (await sql`SELECT id, status FROM bids WHERE job_id = ${jobId} AND freelancer_address = ${me}`) as Row[]
      const current = existing[0]
      if (current?.status === 'accepted') {
        throw new HttpError(409, 'Your bid was accepted and can no longer be changed')
      }
      const rows = current
        ? await sql`
            UPDATE bids SET amount = ${amount}, delivery_seconds = ${deliverySeconds}, proposal = ${proposal},
              status = 'open', updated_at = now()
            WHERE id = ${String(current.id)} AND status <> 'accepted' RETURNING *`
        : await sql`
            INSERT INTO bids (job_id, freelancer_address, amount, delivery_seconds, proposal)
            VALUES (${jobId}, ${me}, ${amount}, ${deliverySeconds}, ${proposal}) RETURNING *`
      const saved = rows[0] as Row | undefined
      if (!saved) throw new HttpError(409, 'Your bid was accepted and can no longer be changed')
      return mapBid(saved)
    },
    { auth: true },
  )

  route(
    'DELETE',
    '/jobs/:id/bids/mine',
    async (ctx) => {
      const me = requireAddress(ctx)
      const jobId = uuid(ctx.params.id ?? '')
      const rows = await sql`
        UPDATE bids SET status = 'withdrawn', updated_at = now()
        WHERE job_id = ${jobId} AND freelancer_address = ${me} AND status = 'open' RETURNING id`
      if (rows.length === 0) {
        const existing = (await sql`SELECT status FROM bids WHERE job_id = ${jobId} AND freelancer_address = ${me}`) as Row[]
        if (existing[0]?.status === 'accepted') {
          throw new HttpError(409, 'An accepted bid cannot be withdrawn. Ask the client to cancel the acceptance.')
        }
        throw new HttpError(404, 'You have no open bid on this job')
      }
      return { ok: true }
    },
    { auth: true },
  )
}
