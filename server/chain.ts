import { createPublicClient, http, type Abi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getChain } from '../src/onchain-facts'
import escrowAbiJson from '../src/lib/JobEscrow.abi.json'
import { env } from './env'

export const escrowAbi = escrowAbiJson as Abi

/** Compass chain key used by the RPC proxy for Arc Testnet. */
const PROXY_CHAIN_KEY = 'Arc_Testnet'

function resolveRpcUrl(): { url: string; viaProxy: boolean } {
  // Your own provider URL wins. It may embed a provider key, so it is never logged and never VITE_-prefixed.
  const own = process.env[`RPC_URL_${PROXY_CHAIN_KEY}`]
  if (own) return { url: own, viaProxy: false }
  const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
  if (
    process.env.RPC_PROXY_BASE_URL &&
    process.env.RPC_PROXY_TOKEN &&
    proxyChains.indexOf(PROXY_CHAIN_KEY) !== -1
  ) {
    return {
      url: `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${PROXY_CHAIN_KEY}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`,
      viaProxy: true,
    }
  }
  // Public RPC from the shared registry. Rate limits for this endpoint are unknown.
  const fallback = getChain(env.chainId)?.rpcUrls[0]
  if (!fallback) throw new Error('No RPC URL available for Arc Testnet')
  return { url: fallback, viaProxy: false }
}

const rpc = resolveRpcUrl()
export const rpcViaProxy = rpc.viaProxy

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpc.url),
})

export interface EscrowParams {
  usdc: Address
  arbiter: Address
  arbiterTimeout: number
  minDeliveryPeriod: number
  minReviewPeriod: number
  maxDeliveryPeriod: number
  maxReviewPeriod: number
}

let cachedParams: EscrowParams | null = null

/** Timing parameters are immutable constructor values, so one successful read is cached forever. */
export async function readEscrowParams(): Promise<EscrowParams | null> {
  if (cachedParams) return cachedParams
  if (!env.escrowAddress) return null
  const address = env.escrowAddress
  const read = <T>(functionName: string) =>
    publicClient.readContract({ address, abi: escrowAbi, functionName } as never) as Promise<T>
  const [usdc, arbiter, arbiterTimeout, minDelivery, minReview, maxDelivery, maxReview] = await Promise.all([
    read<Address>('usdc'),
    read<Address>('arbiter'),
    read<bigint>('arbiterTimeout'),
    read<bigint>('minDeliveryPeriod'),
    read<bigint>('minReviewPeriod'),
    read<bigint>('MAX_DELIVERY_PERIOD'),
    read<bigint>('MAX_REVIEW_PERIOD'),
  ])
  cachedParams = {
    usdc,
    arbiter,
    arbiterTimeout: Number(arbiterTimeout),
    minDeliveryPeriod: Number(minDelivery),
    minReviewPeriod: Number(minReview),
    maxDeliveryPeriod: Number(maxDelivery),
    maxReviewPeriod: Number(maxReview),
  }
  return cachedParams
}

/** True when the pair (client, jobRef) already has an escrow onchain. */
export async function isRefFunded(client: Address, jobRef: `0x${string}`): Promise<boolean> {
  if (!env.escrowAddress) return false
  const id = (await publicClient.readContract({
    address: env.escrowAddress,
    abi: escrowAbi,
    functionName: 'escrowIdByRef',
    args: [client, jobRef],
  })) as bigint
  return id !== 0n
}

let arbiterCache: { value: Address; at: number } | null = null

/** The current arbiter, read from the contract (it can be rotated), cached briefly. Lowercased. */
export async function currentArbiter(): Promise<Address | null> {
  if (!env.escrowAddress) return null
  if (arbiterCache && Date.now() - arbiterCache.at < 15_000) return arbiterCache.value
  const value = (await publicClient.readContract({
    address: env.escrowAddress,
    abi: escrowAbi,
    functionName: 'arbiter',
  })) as Address
  arbiterCache = { value: value.toLowerCase() as Address, at: Date.now() }
  return arbiterCache.value
}
