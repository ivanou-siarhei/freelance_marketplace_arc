import { sql } from './db'

/** Return an unfunded accepted job and its bid to open. Shared by manual cancel and expiry. */
export async function reopenJob(jobId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx`
      UPDATE jobs SET status = 'open', accepted_bid_id = NULL, accepted_at = NULL,
        funding_expires_at = NULL, job_ref = NULL, updated_at = now()
      WHERE id = ${jobId} AND status = 'awaiting_funding' RETURNING id`
    if (rows.length === 0) return
    await tx`UPDATE bids SET status = 'open', updated_at = now() WHERE job_id = ${jobId} AND status = 'accepted'`
  })
}
