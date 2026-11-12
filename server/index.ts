import { endSession, issueNonce, verifyAndCreateSession, AuthError } from './auth'
import { migrate } from './db'
import { env } from './env'
import { handle, HttpError, route } from './http'
import { startIndexer } from './indexer'
import { registerBidRoutes } from './routes/bids'
import { registerDisputeRoutes } from './routes/disputes'
import { registerEscrowRoutes } from './routes/escrows'
import { registerJobRoutes } from './routes/jobs'
import { registerProfileRoutes } from './routes/profiles'

route('POST', '/auth/nonce', async () => issueNonce())

route('POST', '/auth/verify', async (ctx) => {
  const body = await ctx.json()
  if (typeof body.message !== 'string' || typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    throw new HttpError(400, 'message and signature are required')
  }
  try {
    return await verifyAndCreateSession(body.message, body.signature as `0x${string}`)
  } catch (error) {
    if (error instanceof AuthError) throw new HttpError(401, error.message)
    throw error
  }
})

route('POST', '/auth/logout', async (ctx) => {
  await endSession(ctx.req)
  return { ok: true }
})

route('GET', '/auth/me', async (ctx) => ({ address: ctx.address }), { auth: true })

registerProfileRoutes()
registerJobRoutes()
registerBidRoutes()
registerEscrowRoutes()
registerDisputeRoutes()

await migrate()
startIndexer()

Bun.serve({
  port: env.port,
  hostname: env.host,
  fetch: handle,
})
console.log(`ArcWork API listening on http://${env.host}:${env.port}`)
