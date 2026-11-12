type Row = Record<string, unknown>

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null

export function mapJob(row: Row) {
  return {
    id: String(row.id),
    clientAddress: String(row.client_address),
    clientName: row.client_name ? String(row.client_name) : '',
    title: String(row.title),
    description: String(row.description),
    category: String(row.category),
    budgetMin: String(row.budget_min),
    budgetMax: String(row.budget_max),
    deadline: iso(row.deadline),
    reviewPeriodSeconds: Number(row.review_period_seconds),
    status: String(row.status),
    acceptedBidId: row.accepted_bid_id ? String(row.accepted_bid_id) : null,
    acceptedAt: iso(row.accepted_at),
    fundingExpiresAt: iso(row.funding_expires_at),
    bidCount: row.bid_count === undefined ? undefined : Number(row.bid_count),
    createdAt: iso(row.created_at),
  }
}

export function mapBid(row: Row) {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    freelancerAddress: String(row.freelancer_address),
    freelancerName: row.freelancer_name ? String(row.freelancer_name) : '',
    amount: String(row.amount),
    deliverySeconds: Number(row.delivery_seconds),
    proposal: String(row.proposal),
    status: String(row.status),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function mapEscrow(row: Row) {
  return {
    escrowId: String(row.escrow_id),
    jobId: String(row.job_id),
    jobRef: String(row.job_ref),
    clientAddress: String(row.client_address),
    freelancerAddress: String(row.freelancer_address),
    amount: String(row.amount),
    deliveryDeadline: iso(row.delivery_deadline),
    reviewPeriodSeconds: Number(row.review_period_seconds),
    status: String(row.onchain_status),
    reviewEndsAt: iso(row.review_ends_at),
    disputedAt: iso(row.disputed_at),
    createdTx: String(row.created_tx),
    lastTx: row.last_tx ? String(row.last_tx) : String(row.created_tx),
  }
}

export function mapDelivery(row: Row) {
  return {
    jobId: String(row.job_id),
    escrowId: String(row.escrow_id),
    note: String(row.note),
    link: String(row.link),
    canonical: String(row.canonical),
    deliveryHash: String(row.delivery_hash),
    onchainHash: row.onchain_hash ? String(row.onchain_hash) : null,
    verified: row.verified === null || row.verified === undefined ? null : Boolean(row.verified),
    submittedAt: iso(row.submitted_at),
  }
}

export function mapProfile(row: Row) {
  return {
    address: String(row.address),
    displayName: String(row.display_name ?? ''),
    bio: String(row.bio ?? ''),
    skills: Array.isArray(row.skills) ? (row.skills as unknown[]).map(String) : [],
    createdAt: iso(row.created_at),
  }
}

export function mapDispute(row: Row) {
  return {
    jobId: String(row.job_id),
    escrowId: String(row.escrow_id),
    reason: String(row.reason ?? ''),
    evidenceLink: String(row.evidence_link ?? ''),
    canonical: String(row.canonical ?? ''),
    reasonHash: String(row.reason_hash),
    onchainHash: row.onchain_hash ? String(row.onchain_hash) : null,
    verified: row.verified === null || row.verified === undefined ? null : Boolean(row.verified),
    status: String(row.status),
    openedAt: iso(row.opened_at),
    freelancerResponse: String(row.freelancer_response ?? ''),
    freelancerEvidenceLink: String(row.freelancer_evidence_link ?? ''),
    respondedAt: iso(row.responded_at),
    resolution: row.resolution ? String(row.resolution) : null,
    freelancerAmount: row.freelancer_amount === null || row.freelancer_amount === undefined ? null : String(row.freelancer_amount),
    clientAmount: row.client_amount === null || row.client_amount === undefined ? null : String(row.client_amount),
    resolvedAt: iso(row.resolved_at),
  }
}
