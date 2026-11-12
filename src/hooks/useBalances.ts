import { useReadContract } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { getUsdc } from '@/onchain-facts'
import { ARC_CHAIN_ID, escrowAbi } from '@/lib/escrow'
import { useAppConfig } from './useAppConfig'

export function usdcAddress(): Address {
  const usdc = getUsdc(ARC_CHAIN_ID)
  if (!usdc) throw new Error('USDC is not available on Arc Testnet in the registry')
  return usdc.address as Address
}

/** The wallet's USDC balance in the ERC-20 view (6 decimals). Arc's native gas balance is the same pool. */
export function useUsdcBalance(owner?: Address) {
  return useReadContract({
    address: usdcAddress(),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(owner), refetchInterval: 8000 },
  })
}

/** USDC credited to the wallet inside the escrow contract and ready to withdraw. */
export function useClaimable(owner?: Address) {
  const { escrowAddress } = useAppConfig()
  return useReadContract({
    address: escrowAddress ?? undefined,
    abi: escrowAbi,
    functionName: 'claimable',
    args: owner ? [owner] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(owner && escrowAddress), refetchInterval: 8000 },
  })
}
