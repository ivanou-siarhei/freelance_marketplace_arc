/**
 * Typed client for the ArcWork backend. In development the Vite server proxies /api to it. For a deployed
 * site, set VITE_API_BASE_URL (public, build time) to the API's address.
 */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(/\/+$/, '')

let sessionToken: string | null = null

export function setApiToken(token: string | null): void {
  sessionToken = token
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Non-JSON error body, handled below.
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`
    throw new ApiError(response.status, message)
  }
  return data as T
}

// ---- response types ----

export type JobStatus =
  | 'open'
  | 'awaiting_funding'
  | 'in_escrow'
  | 'submitted'
  | 'completed'
  | 'cancelled'
  | 'disputed'

export interface Job {
  id: string
  clientAddress: string
  clientName: string
  title: string
  description: string
  category: string
  budgetMin: string
  budgetMax: string
  deadline: string | null
  reviewPeriodSeconds: number
  status: JobStatus
  acceptedBidId: string | null
  acceptedAt: string | null
  fundingExpiresAt: string | null
  bidCount?: number
  createdAt: string | null
}

export interface Bid {
  id: string
  jobId: string
  freelancerAddress: string
  freelancerName: string
  amount: string
  deliverySeconds: number
  proposal: string
  status: 'open' | 'accepted' | 'funded' | 'withdrawn' | 'rejected'
  createdAt: string | null
  updatedAt: string | null
}

export type EscrowStatus = 'funded' | 'submitted' | 'disputed' | 'released' | 'resolved' | 'cancelled'

export interface Escrow {
  escrowId: string
  jobId: string
  jobRef: string
  clientAddress: string
  freelancerAddress: string
  amount: string
  deliveryDeadline: string | null
  reviewPeriodSeconds: number
  status: EscrowStatus
  reviewEndsAt: string | null
  disputedAt: string | null
  createdTx: string
  lastTx: string
  jobTitle?: string
}

export interface Delivery {
  jobId: string
  escrowId: string
  note: string
  link: string
  canonical: string
  deliveryHash: string
  onchainHash: string | null
  verified: boolean | null
  submittedAt: string | null
}

export interface FundingTerms {
  jobRef: string
  freelancer: string
  amount: string
  deliverySeconds: number
  reviewPeriodSeconds: number
  bidId: string
}

export interface Dispute {
  jobId: string
  escrowId: string
  reason: string
  evidenceLink: string
  canonical: string
  reasonHash: string
  onchainHash: string | null
  verified: boolean | null
  status: 'prepared' | 'open' | 'resolved'
  openedAt: string | null
  freelancerResponse: string
  freelancerEvidenceLink: string
  respondedAt: string | null
  resolution: 'arbiter' | 'stale' | null
  freelancerAmount: string | null
  clientAmount: string | null
  resolvedAt: string | null
}

export interface DisputeQueueItem {
  dispute: Dispute
  jobTitle: string
  jobDescription: string
  escrow: Escrow
  delivery: Delivery | null
}

export interface JobDetailResponse {
  job: Job
  escrow: Escrow | null
  bids: Bid[]
  fundingTerms: FundingTerms | null
  delivery: Delivery | null
  dispute: Dispute | null
  isArbiter: boolean
  role: 'client' | 'freelancer' | 'visitor'
}

export interface HealthResponse {
  ok: boolean
  indexer: { enabled: boolean; lastBlock?: string | null; head?: string; blocksBehind?: string | null; error?: string | null }
}

export interface Profile {
  address: string
  displayName: string
  bio: string
  skills: string[]
  createdAt: string | null
}

export interface EscrowParams {
  usdc: string
  arbiter: string
  arbiterTimeout: number
  minDeliveryPeriod: number
  minReviewPeriod: number
  maxDeliveryPeriod: number
  maxReviewPeriod: number
}

export interface AppConfig {
  chainId: number
  escrowAddress: string | null
  deployBlock: string | null
  params: EscrowParams | null
  categories: string[]
}

export interface Anomaly {
  txHash: string
  jobRef: string | null
  jobId: string | null
  jobTitle: string | null
  reason: string
  seenAt: string | null
}
