/**
 * Job reference derivation, shared by the backend and the browser.
 *
 * A job reference binds an escrow to one specific job, bid, client, freelancer and amount:
 *   keccak256(abi.encode(jobId, bidId, client, freelancer, amount))
 * The backend stores it when a client accepts a bid. The browser recomputes it before funding so a
 * wrong reference from the server is caught before any USDC moves, and the indexer rechecks it.
 */
import { encodeAbiParameters, keccak256, pad, type Address, type Hex } from 'viem'

/** A UUID as a left-aligned 32-byte word (the 16 UUID bytes followed by zero padding). */
export function uuidToBytes32(uuid: string): Hex {
  const hex = uuid.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('Invalid UUID')
  return pad(`0x${hex}`, { dir: 'right', size: 32 })
}

export function deriveJobRef(input: {
  jobId: string
  bidId: string
  client: Address
  freelancer: Address
  amount: bigint
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        uuidToBytes32(input.jobId),
        uuidToBytes32(input.bidId),
        input.client,
        input.freelancer,
        input.amount,
      ],
    ),
  )
}
