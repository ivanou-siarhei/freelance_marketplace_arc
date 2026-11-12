import type { Abi } from 'viem'
import escrowAbiJson from './JobEscrow.abi.json'

export const escrowAbi = escrowAbiJson as Abi

/** Arc Testnet. The app is testnet only. */
export const ARC_CHAIN_ID = 5042002 as const

/** The minimal EIP-2612 surface used for one-transaction funding. */
export const permitAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const

export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const
