import { isAddress, type Address } from 'viem'
import { getSession } from './auth'
import { env } from './env'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  /** Lowercased wallet address of the signed-in user, if any. */
  address: Address | null
  json: () => Promise<Record<string, unknown>>
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
  auth: boolean
}

const routes: Route[] = []

export function route(method: string, path: string, handler: Handler, options: { auth?: boolean } = {}): void {
  const keys: string[] = []
  const source = path.replace(/:([a-zA-Z]+)/g, (_match, key: string) => {
    keys.push(key)
    return '([^/]+)'
  })
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, auth: options.auth ?? false })
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Allow a browser on a listed origin to call this API. Anything not listed gets no CORS headers at all. */
function withCors(req: Request, response: Response): Response {
  const origin = req.headers.get('origin')?.toLowerCase()
  if (!origin || !env.corsOrigins.includes(origin)) return response
  response.headers.set('access-control-allow-origin', origin)
  response.headers.set('vary', 'origin')
  return response
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    const preflight = new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      },
    })
    return withCors(req, preflight)
  }
  return withCors(req, await dispatch(req))
}

async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url)
  try {
    for (const candidate of routes) {
      if (candidate.method !== req.method) continue
      const match = candidate.pattern.exec(url.pathname)
      if (!match) continue
      const params: Record<string, string> = {}
      candidate.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? '')
      })
      const address = await getSession(req)
      if (candidate.auth && !address) throw new HttpError(401, 'Sign in with your wallet to continue')
      const ctx: Ctx = {
        req,
        url,
        params,
        address,
        json: async () => {
          const text = await req.text()
          if (text.length > 100_000) throw new HttpError(413, 'Request body too large')
          try {
            const parsed: unknown = JSON.parse(text || '{}')
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              throw new HttpError(400, 'Body must be a JSON object')
            }
            return parsed as Record<string, unknown>
          } catch (error) {
            if (error instanceof HttpError) throw error
            throw new HttpError(400, 'Invalid JSON body')
          }
        },
      }
      const result = await candidate.handler(ctx)
      return respond(200, result ?? { ok: true })
    }
    throw new HttpError(404, 'Not found')
  } catch (error) {
    if (error instanceof HttpError) return respond(error.status, { error: error.message })
    console.error('Unhandled error', error)
    return respond(500, { error: 'Internal server error' })
  }
}

// ---- input validation helpers ----

export function str(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required`)
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, `${field} must be ${min} to ${max} characters`)
  }
  return trimmed
}

export function optStr(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === '') return ''
  return str(value, field, 0, max)
}

/** Positive integer string in USDC base units. */
export function rawAmount(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9]{1,30}$/.test(value) || BigInt(value) <= 0n) {
    throw new HttpError(400, `${field} must be a positive amount`)
  }
  return BigInt(value).toString()
}

export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`)
  }
  return value
}

export function uuid(value: string, field = 'id'): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `Invalid ${field}`)
  }
  return value.toLowerCase()
}

export function addr(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new HttpError(400, 'Invalid address')
  return value.toLowerCase() as Address
}

export function requireAddress(ctx: Ctx): Address {
  if (!ctx.address) throw new HttpError(401, 'Sign in with your wallet to continue')
  return ctx.address
}
