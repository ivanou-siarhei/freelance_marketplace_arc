export const CATEGORIES = [
  'Development',
  'Design',
  'Writing',
  'Marketing',
  'Video and Audio',
  'Data and Research',
  'Consulting',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** One hour of slack added to a funding deadline so mining delay cannot shorten the agreed delivery time. */
export const DEADLINE_BUFFER_SECONDS = 3600
/** Longest delivery time a bid can promise (the contract caps the deadline at 90 days). */
export const MAX_BID_DELIVERY_SECONDS = 89 * 24 * 3600
