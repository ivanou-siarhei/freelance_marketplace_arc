import type { Address, Hex } from 'viem'
import { CATEGORIES } from '../../src/lib/categories'
import { deriveJobRef } from '../../src/lib/jobRef'
import { currentArbiter, isRefFunded, publicClient, readEscrowParams } from '../chain'
import { sql } from '../db'
import { env } from '../env'
import { indexerStatus, syncNow } from '../indexer'
import { reopenJob } from '../jobState'
import { HttpError, rawAmount, requireAddress, route, str, uuid, integer } from '../http'
import { mapBid, mapDelivery, mapDispute, mapEscrow, mapJob } from '../serialize'

type Row = Record<string, unknown>

const JOB_SELECT = `
  SELECT j.*, u.display_name AS client_name,
    (SELECT count(*) FROM bids b WHERE b.job_id = j.id AND b.status IN ('open','accepted')) AS bid_count
  FROM jobs j LEFT JOIN users u ON u.address = j.client_address`

async function loadJob(id: string): Promise<Row> {
  const rows = (await sql.unsafe(`${JOB_SELECT} WHERE j.id = $1`, [id])) as Row[]
  const job = rows[0]
  if (!job) throw new HttpError(404, 'Job not found')
  return job
}

export function registerJobRoutes(): void {
  route('GET', '/health', async () => {
    return { ok: true, indexer: await indexerStatus() }
  })

  route('GET', '/config', async () => {
    const params = await readEscrowParams().catch(() => null)
    return {
      chainId: env.chainId,
      escrowAddress: env.escrowAddress ?? null,
      deployBlock: env.escrowDeployBlock?.toString() ?? null,
      params,
      categories: CATEGORIES,
    }
  })

  route('GET', '/jobs', async (ctx) => {
    const q = ctx.url.searchParams
    const where: string[] = []
    const values: unknown[] = []
    const add = (clause: string, value: unknown) => {
      values.push(value)
      where.push(clause.split('?').join(`$${values.length}`))
    }

    const mine = q.get('mine')
    if (mine === 'client') add('j.client_address = ?', requireAddress(ctx))
    else if (mine === 'bidder') {
      add('EXISTS (SELECT 1 FROM bids b WHERE b.job_id = j.id AND b.freelancer_address = ?)', requireAddress(ctx))
    } else if (mine === 'freelancer') {
      add('EXISTS (SELECT 1 FROM escrows e WHERE e.job_id = j.id AND e.freelancer_address = ?)', requireAddress(ctx))
    }

    const status = q.get('status')
    if (status && status !== 'all') add('j.status = ?', status)
    else if (!mine && !status) where.push(`j.status = 'open'`)

    const category = q.get('category')
    if (category) add('j.category = ?', category)
    const search = q.get('search')?.trim()
    if (search) add('(j.title ILIKE ? OR j.description ILIKE ?)', `%${search.slice(0, 80)}%`)
    const min = q.get('minBudget')
    if (min && /^\d{1,30}$/.test(min)) add('j.budget_max >= ?', min)
    const max = q.get('maxBudget')
    if (max && /^\d{1,30}$/.test(max)) add('j.budget_min <= ?', max)

    const limit = Math.min(Math.max(Number(q.get('limit') ?? 30) || 30, 1), 60)
    const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0)
    const text = `${JOB_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY j.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    const rows = (await sql.unsafe(text, values)) as Row[]
    return { jobs: rows.map(mapJob) }
  })

  route(
    'POST',
    '/jobs',
    async (ctx) => {
      const client = requireAddress(ctx)
      const body = await ctx.json()
      const title = str(body.title, 'Title', 3, 120)
      const description = str(body.description, 'Description', 10, 5000)
      const category = str(body.category, 'Category', 1, 40)
      if (!(CATEGORIES as readonly string[]).includes(category)) throw new HttpError(400, 'Unknown category')
      const budgetMin = rawAmount(body.budgetMin, 'Minimum budget')
      const budgetMax = rawAmount(body.budgetMax, 'Maximum budget')
      if (BigInt(budgetMin) > BigInt(budgetMax)) throw new HttpError(400, 'Minimum budget cannot exceed the maximum')

      const params = await readEscrowParams().catch(() => null)
      const minReview = params?.minReviewPeriod ?? 60
      const maxReview = params?.maxReviewPeriod ?? 30 * 24 * 3600
      const reviewPeriodSeconds = integer(body.reviewPeriodSeconds, 'Review period', minReview, maxReview)

      let deadline: Date | null = null
      if (body.deadline !== undefined && body.deadline !== null && body.deadline !== '') {
        deadline = new Date(String(body.deadline))
        if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
          throw new HttpError(400, 'Bidding deadline must be in the future')
        }
      }

      await sql`INSERT INTO users (address) VALUES (${client}) ON CONFLICT (address) DO NOTHING`
      const rows = await sql`
        INSERT INTO jobs (client_address, title, description, category, budget_min, budget_max, deadline, review_period_seconds)
        VALUES (${client}, ${title}, ${description}, ${category}, ${budgetMin}, ${budgetMax}, ${deadline}, ${reviewPeriodSeconds})
        RETURNING id`
      const created = rows[0] as { id: string }
      return mapJob(await loadJob(created.id))
    },
    { auth: true },
  )

  route('GET', '/jobs/:id', async (ctx) => {
    const id = uuid(ctx.params.id ?? '')
    const job = await loadJob(id)
    const jobOut = mapJob(job)
    const me = ctx.address
    const isClient = me === jobOut.clientAddress

    const escrowRows = (await sql`SELECT * FROM escrows WHERE job_id = ${id}`) as Row[]
    const escrow = escrowRows[0] ? mapEscrow(escrowRows[0]) : null
    const isFreelancer = Boolean(me && escrow && escrow.freelancerAddress === me)

    // The client sees every bid; a bidder sees only their own; everyone else sees the count.
    let bids: ReturnType<typeof mapBid>[] = []
    if (me) {
      const bidRows = (await sql`
        SELECT b.*, u.display_name AS freelancer_name FROM bids b
        LEFT JOIN users u ON u.address = b.freelancer_address
        WHERE b.job_id = ${id} AND b.status <> 'withdrawn'
          AND (${isClient} OR b.freelancer_address = ${me})
        ORDER BY b.created_at ASC`) as Row[]
      bids = bidRows.map(mapBid)
    }

    let fundingTerms: null | {
      jobRef: string
      freelancer: string
      amount: string
      deliverySeconds: number
      reviewPeriodSeconds: number
      bidId: string
    } = null
    if (isClient && jobOut.status === 'awaiting_funding' && job.job_ref) {
      const bid = bids.find((b) => b.id === jobOut.acceptedBidId)
      if (bid) {
        fundingTerms = {
          jobRef: String(job.job_ref),
          freelancer: bid.freelancerAddress,
          amount: bid.amount,
          deliverySeconds: bid.deliverySeconds,
          reviewPeriodSeconds: jobOut.reviewPeriodSeconds,
          bidId: bid.id,
        }
      }
    }

    // The arbiter can read the delivery and the dispute, but only once there is a dispute to decide.
    const arbiter = await currentArbiter().catch(() => null)
    const disputeRows = (await sql`SELECT * FROM disputes WHERE job_id = ${id}`) as Row[]
    const disputeRow = disputeRows[0]
    const isArbiter = Boolean(me && arbiter && me === arbiter && disputeRow && disputeRow.status !== 'prepared')
    const dispute =
      disputeRow && (isClient || isFreelancer || isArbiter) && (disputeRow.status !== 'prepared' || isClient)
        ? mapDispute(disputeRow)
        : null

    let delivery: ReturnType<typeof mapDelivery> | null = null
    if (isClient || isFreelancer || isArbiter) {
      const rows = (await sql`SELECT * FROM deliveries WHERE job_id = ${id}`) as Row[]
      delivery = rows[0] ? mapDelivery(rows[0]) : null
    }

    return {
      job: jobOut,
      escrow,
      bids,
      fundingTerms,
      delivery,
      dispute,
      isArbiter,
      role: isClient ? 'client' : isFreelancer ? 'freelancer' : 'visitor',
    }
  })

  // A client may cancel a job only while it is open. Accepted or funded jobs follow their own flows.
  route(
    'POST',
    '/jobs/:id/cancel',
    async (ctx) => {
      const me = requireAddress(ctx)
      const id = uuid(ctx.params.id ?? '')
      const updated = await sql`
        UPDATE jobs SET status = 'cancelled', updated_at = now()
        WHERE id = ${id} AND client_address = ${me} AND status = 'open'
        RETURNING id`
      if (updated.length === 0) {
        await assertOwnedBy(id, me)
        throw new HttpError(409, 'Only an open job can be cancelled')
      }
      await sql`UPDATE bids SET status = 'rejected', updated_at = now() WHERE job_id = ${id} AND status = 'open'`
      return mapJob(await loadJob(id))
    },
    { auth: true },
  )

  route(
    'POST',
    '/jobs/:id/accept',
    async (ctx) => {
      const me = requireAddress(ctx)
      const id = uuid(ctx.params.id ?? '')
      const body = await ctx.json()
      const bidId = uuid(String(body.bidId ?? ''), 'bidId')
      await assertOwnedBy(id, me)

      const bidRows = (await sql`SELECT * FROM bids WHERE id = ${bidId} AND job_id = ${id}`) as Row[]
      const bid = bidRows[0]
      if (!bid) throw new HttpError(404, 'Bid not found on this job')
      if (bid.status !== 'open') throw new HttpError(409, 'That bid is no longer open')
      if (String(bid.freelancer_address) === me) throw new HttpError(400, 'You cannot hire yourself')

      const jobRef = deriveJobRef({
        jobId: id,
        bidId,
        client: me as Address,
        freelancer: String(bid.freelancer_address) as Address,
        amount: BigInt(String(bid.amount)),
      })
      if (await isRefFunded(me, jobRef)) throw new HttpError(409, 'This job reference is already funded onchain')

      const fundingExpiresAt = new Date(Date.now() + env.fundingWindowMs)
      const claimed = await sql.begin(async (tx) => {
        const locked = await tx`
          UPDATE jobs SET status = 'awaiting_funding', accepted_bid_id = ${bidId}, accepted_at = now(),
            funding_expires_at = ${fundingExpiresAt}, job_ref = ${jobRef}, updated_at = now()
          WHERE id = ${id} AND client_address = ${me} AND status = 'open' RETURNING id`
        if (locked.length === 0) return false
        await tx`UPDATE bids SET status = 'accepted', updated_at = now() WHERE id = ${bidId}`
        await tx`
          INSERT INTO job_refs (job_ref, job_id, bid_id, client_address, freelancer_address, amount)
          VALUES (${jobRef}, ${id}, ${bidId}, ${me}, ${String(bid.freelancer_address)}, ${String(bid.amount)})
          ON CONFLICT (job_ref) DO NOTHING`
        return true
      })
      if (!claimed) throw new HttpError(409, 'This job already has an accepted bid')
      return mapJob(await loadJob(id))
    },
    { auth: true },
  )

  // Cancel an acceptance that was never funded; the bid and the job go back to open.
  route(
    'POST',
    '/jobs/:id/unaccept',
    async (ctx) => {
      const me = requireAddress(ctx)
      const id = uuid(ctx.params.id ?? '')
      await assertOwnedBy(id, me)
      await Promise.race([syncNow(), new Promise((resolve) => setTimeout(resolve, 20_000))])
      const job = await loadJob(id)
      if (job.status !== 'awaiting_funding') throw new HttpError(409, 'There is no unfunded acceptance to cancel')
      if (job.job_ref && (await isRefFunded(me, job.job_ref as Hex))) {
        throw new HttpError(409, 'Funding already happened onchain; wait for it to be recorded')
      }
      await reopenJob(id)
      return mapJob(await loadJob(id))
    },
    { auth: true },
  )

  route(
    'POST',
    '/jobs/:id/sync',
    async (ctx) => {
      const id = uuid(ctx.params.id ?? '')
      const body = await ctx.json()
      const txHash = typeof body.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(body.txHash) ? (body.txHash as Hex) : null
      if (txHash) {
        try {
          await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 25_000 })
        } catch {
          throw new HttpError(504, 'The transaction is not confirmed yet; try again shortly')
        }
      }
      // A long catch-up must not hold the request open; the pass keeps running in the background.
      await Promise.race([syncNow(), new Promise((resolve) => setTimeout(resolve, 20_000))])
      return mapJob(await loadJob(id))
    },
    { auth: true },
  )
}

async function assertOwnedBy(jobId: string, client: string): Promise<void> {
  const rows = await sql`SELECT client_address FROM jobs WHERE id = ${jobId}`
  const row = rows[0] as { client_address: string } | undefined
  if (!row) throw new HttpError(404, 'Job not found')
  if (row.client_address !== client) throw new HttpError(403, 'Only the client who posted this job can do that')
}
