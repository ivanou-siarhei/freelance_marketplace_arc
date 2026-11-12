import { generateSiweNonce, parseSiweMessage, verifySiweMessage } from 'viem/siwe'
import type { Address } from 'viem'
import { publicClient } from './chain'
import { sql } from './db'
import { env } from './env'

/**
 * Domain allowlist check. The allowlist comes only from SIWE_ALLOWED_DOMAINS on the server; it is
 * never built from the Origin or Host headers of the request. Entries are exact hosts or the
 * explicit parent rule `*.example.com`, which matches any subdomain at a label boundary and never
 * the bare parent itself.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false
  const candidate = host.toLowerCase()
  return env.allowedDomains.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2)
      if (!suffix || !candidate.endsWith(`.${suffix}`)) return false
      const prefix = candidate.slice(0, candidate.length - suffix.length - 1)
      return prefix.length > 0 && prefix.split('.').every((label) => label.length > 0)
    }
    return candidate === entry
  })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function issueNonce(): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = generateSiweNonce()
  const expiresAt = new Date(Date.now() + env.nonceTtlMs)
  await sql`DELETE FROM nonces WHERE expires_at < now() - interval '1 hour'`
  await sql`INSERT INTO nonces (nonce, expires_at) VALUES (${nonce}, ${expiresAt})`
  return { nonce, expiresAt: expiresAt.toISOString() }
}

export class AuthError extends Error {}

const MAX_MESSAGE_AGE_MS = 10 * 60_000

export async function verifyAndCreateSession(
  message: string,
  signature: `0x${string}`,
): Promise<{ token: string; address: Address; expiresAt: string }> {
  const parsed = parseSiweMessage(message)
  if (!parsed.address || !parsed.domain || !parsed.nonce || !parsed.uri || !parsed.issuedAt) {
    throw new AuthError('Malformed sign-in message')
  }
  if (!isAllowedHost(parsed.domain)) throw new AuthError('This site is not allowed to sign in')
  let uriHost: string
  try {
    uriHost = new URL(parsed.uri).host
  } catch {
    throw new AuthError('Invalid sign-in URI')
  }
  if (!isAllowedHost(uriHost)) throw new AuthError('This site is not allowed to sign in')
  if (parsed.chainId !== env.chainId) throw new AuthError('Wrong network in sign-in message')

  const now = Date.now()
  if (Math.abs(now - parsed.issuedAt.getTime()) > MAX_MESSAGE_AGE_MS) {
    throw new AuthError('Sign-in message has expired, try again')
  }
  if (parsed.expirationTime && parsed.expirationTime.getTime() <= now) throw new AuthError('Sign-in message has expired')
  if (parsed.notBefore && parsed.notBefore.getTime() > now) throw new AuthError('Sign-in message is not valid yet')

  const valid = await verifySiweMessage(publicClient, {
    message,
    signature,
    domain: parsed.domain,
    nonce: parsed.nonce,
    time: new Date(now),
  })
  if (!valid) throw new AuthError('Signature could not be verified')

  // Consume the nonce atomically. A nonce works once and only before it expires.
  const consumed = await sql`
    UPDATE nonces SET used = true
    WHERE nonce = ${parsed.nonce} AND used = false AND expires_at > now()
    RETURNING nonce`
  if (consumed.length === 0) throw new AuthError('Sign-in link is stale, try again')

  const address = parsed.address.toLowerCase() as Address
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(now + env.sessionTtlMs)
  await sql`DELETE FROM sessions WHERE expires_at < now()`
  await sql`INSERT INTO sessions (token_hash, address, expires_at) VALUES (${await sha256Hex(token)}, ${address}, ${expiresAt})`
  await sql`INSERT INTO users (address) VALUES (${address}) ON CONFLICT (address) DO NOTHING`
  return { token, address, expiresAt: expiresAt.toISOString() }
}

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header)
  return match ? (match[1] ?? null) : null
}

export async function getSession(req: Request): Promise<Address | null> {
  const token = bearer(req)
  if (!token) return null
  const rows = await sql`
    SELECT address FROM sessions WHERE token_hash = ${await sha256Hex(token)} AND expires_at > now()`
  const row = rows[0] as { address: string } | undefined
  return row ? (row.address as Address) : null
}

export async function endSession(req: Request): Promise<void> {
  const token = bearer(req)
  if (!token) return
  await sql`DELETE FROM sessions WHERE token_hash = ${await sha256Hex(token)}`
}
