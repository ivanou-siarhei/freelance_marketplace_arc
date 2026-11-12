import { USDC_DECIMALS } from '@/onchain-facts'
import { formatUnitsFixed, parseUsdc } from '@/onchain-money'
import type { JobStatus } from './api'

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/** Whole USDC with two decimals, e.g. "1,250.00". Amounts are in the ERC-20 view (6 decimals). */
export function formatUsdcAmount(raw: string | bigint): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw)
  const fixed = formatUnitsFixed(value, USDC_DECIMALS, 2)
  const [whole = '0', fraction = '00'] = fixed.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}

/** Parse user input like "125.50" into base units, or null when invalid or not positive. */
export function tryParseUsdc(input: string): bigint | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const value = parseUsdc(trimmed)
    return value > 0n ? value : null
  } catch {
    return null
  }
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes} min`
  return `${seconds}s`
}

/** Compact countdown for a future timestamp. */
export function formatCountdown(target: number, now: number): string {
  const remaining = Math.max(0, Math.floor((target - now) / 1000))
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const seconds = remaining % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  open: 'Open for bids',
  awaiting_funding: 'Awaiting funding',
  in_escrow: 'In progress',
  submitted: 'In review',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'In dispute',
}

export const STATUS_TONE: Record<JobStatus, 'ok' | 'warn' | 'neutral' | 'danger' | 'info'> = {
  open: 'ok',
  awaiting_funding: 'warn',
  in_escrow: 'info',
  submitted: 'info',
  completed: 'neutral',
  cancelled: 'neutral',
  disputed: 'danger',
}

/** Turn a wallet or RPC error into a short sentence for the user. */
export function parseOnchainError(error: unknown): string {
  const raw = error instanceof Error ? `${error.message} ${(error as { shortMessage?: string }).shortMessage ?? ''}` : String(error)
  const message = raw.toLowerCase()
  if (message.includes('user rejected') || message.includes('user denied') || message.includes('rejected the request')) {
    return 'Cancelled in your wallet.'
  }
  if (message.includes('insufficient funds') || message.includes('exceeds balance') || message.includes('transfer amount exceeds')) {
    return 'Not enough USDC in your wallet for this.'
  }
  if (message.includes('toearly') || message.includes('too early')) return 'It is too early for that action. Check the countdown.'
  if (message.includes('toolate') || message.includes('too late')) return 'It is too late for that action.'
  if (message.includes('duplicatejobref')) return 'This job has already been funded by your wallet.'
  if (message.includes('arbiterconflict')) return 'The arbiter wallet cannot be a party to a job. Use different wallets for client, freelancer and arbiter.'
  if (message.includes('invalidfreelancer')) return 'The client and freelancer must be different wallets.'
  if (message.includes('invalidstatus')) return 'The job is no longer in the right state for that. Refresh and try again.'
  if (message.includes('reverted')) return 'The transaction was rejected by the contract.'
  if (message.includes('network') || message.includes('timeout') || message.includes('fetch')) {
    return 'Network problem. Check your connection and try again.'
  }
  return error instanceof Error && error.message.length < 140 ? error.message : 'Something went wrong. Please try again.'
}
