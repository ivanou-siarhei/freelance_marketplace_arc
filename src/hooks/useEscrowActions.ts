import { useCallback, useState } from 'react'
import { useAccount, useConfig } from 'wagmi'
import {
  readContract,
  signTypedData,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import { erc20Abi, parseSignature, type Address, type Hex } from 'viem'
import { toast } from 'sonner'
import { api, type Escrow, type FundingTerms } from '@/lib/api'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { DEADLINE_BUFFER_SECONDS } from '@/lib/categories'
import { deriveJobRef } from '@/lib/jobRef'
import { ARC_CHAIN_ID, PERMIT_TYPES, escrowAbi, permitAbi } from '@/lib/escrow'
import { parseOnchainError } from '@/lib/format'
import { usdcAddress } from './useBalances'
import { useAppConfig } from './useAppConfig'

const CANCELLED = 'Cancelled in your wallet.'

function isRejection(error: unknown): boolean {
  return parseOnchainError(error) === CANCELLED
}

/** Every escrow transaction, with real wallet and receipt states. Nothing here simulates progress. */
export function useEscrowActions() {
  const wagmiConfig = useConfig()
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { escrowAddress, params } = useAppConfig()
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['job'] }),
      queryClient.invalidateQueries({ queryKey: ['jobs'] }),
      queryClient.invalidateQueries({ queryKey: ['escrows'] }),
      queryClient.invalidateQueries({ queryKey: ['anomalies'] }),
      queryClient.invalidateQueries({ queryKey: ['readContract'] }),
    ])
  }, [queryClient])

  const requireReady = useCallback(async (): Promise<{ owner: Address; escrow: Address }> => {
    if (!address) throw new Error('Connect your wallet first.')
    if (!escrowAddress) throw new Error('The escrow contract is not configured yet.')
    await switchChain(wagmiConfig, { chainId: ARC_CHAIN_ID })
    return { owner: address, escrow: escrowAddress }
  }, [address, escrowAddress, wagmiConfig])

  const send = useCallback(
    async (escrow: Address, functionName: string, args: readonly unknown[] = []): Promise<Hex> => {
      const hash = await writeContract(wagmiConfig, {
        address: escrow,
        abi: escrowAbi,
        functionName,
        args,
        chainId: ARC_CHAIN_ID,
      })
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: ARC_CHAIN_ID })
      if (receipt.status !== 'success') throw new Error('The transaction reverted.')
      return hash
    },
    [wagmiConfig],
  )

  const syncJob = useCallback(
    async (jobId: string, txHash: Hex) => {
      try {
        await api(`/jobs/${jobId}/sync`, { method: 'POST', body: { txHash } })
      } catch {
        // The indexer will pick the event up on its next pass.
      }
      await refresh()
    },
    [refresh],
  )

  const run = useCallback(async (label: string, success: string, task: () => Promise<Hex | void>): Promise<boolean> => {
    setBusy(label)
    try {
      const hash = await task()
      toast.success(success, {
        action: hash
          ? {
              label: 'View transaction',
              onClick: () => window.open(buildTxExplorerUrl(ARC_CHAIN_ID, hash), '_blank', 'noopener,noreferrer'),
            }
          : undefined,
      })
      return true
    } catch (error) {
      if (!isRejection(error)) toast.error(parseOnchainError(error))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  /** Fund an escrow for an accepted bid. Uses one transaction with a permit, or approve then create. */
  const fund = useCallback(
    (jobId: string, terms: FundingTerms) =>
      run('Funding escrow', 'Escrow funded. Your USDC is now held by the contract.', async () => {
        const { owner, escrow } = await requireReady()
        const amount = BigInt(terms.amount)
        const expected = deriveJobRef({
          jobId,
          bidId: terms.bidId,
          client: owner.toLowerCase() as Address,
          freelancer: terms.freelancer as Address,
          amount,
        })
        if (expected.toLowerCase() !== terms.jobRef.toLowerCase()) {
          throw new Error('The job reference did not match the accepted bid. Refresh and try again.')
        }
        const usdc = usdcAddress()
        const balance = await readContract(wagmiConfig, {
          address: usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner],
          chainId: ARC_CHAIN_ID,
        })
        if (balance < amount) throw new Error('Not enough USDC in your wallet for this.')

        const now = Math.floor(Date.now() / 1000)
        const minDelivery = params?.minDeliveryPeriod ?? 60
        const deadline = BigInt(now + Math.max(terms.deliverySeconds + DEADLINE_BUFFER_SECONDS, minDelivery + 120))
        const review = BigInt(terms.reviewPeriodSeconds)
        const createArgs = [terms.jobRef, terms.freelancer, amount, deadline, review] as const

        // Prefer a single transaction: sign an EIP-2612 permit, then fund. Fall back to approve + fund.
        let permitSignature: Hex | null = null
        const permitDeadline = BigInt(now + 1800)
        try {
          const [nonce, name, version] = await Promise.all([
            readContract(wagmiConfig, { address: usdc, abi: permitAbi, functionName: 'nonces', args: [owner], chainId: ARC_CHAIN_ID }),
            readContract(wagmiConfig, { address: usdc, abi: permitAbi, functionName: 'name', chainId: ARC_CHAIN_ID }),
            readContract(wagmiConfig, { address: usdc, abi: permitAbi, functionName: 'version', chainId: ARC_CHAIN_ID }),
          ])
          permitSignature = await signTypedData(wagmiConfig, {
            domain: { name, version, chainId: ARC_CHAIN_ID, verifyingContract: usdc },
            types: PERMIT_TYPES,
            primaryType: 'Permit',
            message: { owner, spender: escrow, value: amount, nonce, deadline: permitDeadline },
          })
        } catch (error) {
          if (isRejection(error)) throw error
          permitSignature = null
        }

        let hash: Hex
        if (permitSignature) {
          const { r, s, v, yParity } = parseSignature(permitSignature)
          const recovery = v !== undefined ? Number(v) : 27 + (yParity ?? 0)
          hash = await send(escrow, 'createEscrowWithPermit', [...createArgs, permitDeadline, recovery, r, s])
        } else {
          const allowance = await readContract(wagmiConfig, {
            address: usdc,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [owner, escrow],
            chainId: ARC_CHAIN_ID,
          })
          if (allowance < amount) {
            const approveHash = await writeContract(wagmiConfig, {
              address: usdc,
              abi: erc20Abi,
              functionName: 'approve',
              args: [escrow, amount],
              chainId: ARC_CHAIN_ID,
            })
            await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId: ARC_CHAIN_ID })
          }
          hash = await send(escrow, 'createEscrow', createArgs)
        }
        await syncJob(jobId, hash)
        return hash
      }),
    [params, requireReady, run, send, syncJob, wagmiConfig],
  )

  /** Record the delivery, then commit its hash onchain. */
  const submitWork = useCallback(
    (jobId: string, escrow: Escrow, note: string, link: string) =>
      run('Submitting work', 'Work submitted. The client now has the review window to respond.', async () => {
        const { escrow: contract } = await requireReady()
        const prepared = await api<{ deliveryHash: Hex }>(`/jobs/${jobId}/delivery`, {
          method: 'POST',
          body: { note, link },
        })
        const hash = await send(contract, 'submitWork', [BigInt(escrow.escrowId), prepared.deliveryHash])
        await syncJob(jobId, hash)
        return hash
      }),
    [requireReady, run, send, syncJob],
  )

  const simple = useCallback(
    (functionName: string, label: string, success: string) =>
      (jobId: string, escrow: Escrow) =>
        run(label, success, async () => {
          const { escrow: contract } = await requireReady()
          const hash = await send(contract, functionName, [BigInt(escrow.escrowId)])
          await syncJob(jobId, hash)
          return hash
        }),
    [requireReady, run, send, syncJob],
  )

  /** Save the reason, then commit its hash onchain. Freezes the escrow for the arbiter. */
  const dispute = useCallback(
    (jobId: string, escrow: Escrow, reason: string, evidenceLink: string) =>
      run('Opening dispute', 'Dispute opened. The arbiter will review it.', async () => {
        const { escrow: contract } = await requireReady()
        const prepared = await api<{ reasonHash: Hex }>(`/jobs/${jobId}/dispute`, {
          method: 'POST',
          body: { reason, evidenceLink },
        })
        const hash = await send(contract, 'dispute', [BigInt(escrow.escrowId), prepared.reasonHash])
        await syncJob(jobId, hash)
        return hash
      }),
    [requireReady, run, send, syncJob],
  )

  /** Arbiter only: split the escrow. The remainder goes to the client. */
  const resolve = useCallback(
    (jobId: string, escrow: Escrow, freelancerAmount: bigint) =>
      run('Settling', 'Dispute settled. Both sides can now withdraw their share.', async () => {
        const { escrow: contract } = await requireReady()
        const hash = await send(contract, 'resolve', [BigInt(escrow.escrowId), freelancerAmount])
        await syncJob(jobId, hash)
        return hash
      }),
    [requireReady, run, send, syncJob],
  )

  const approve = simple('approve', 'Approving', 'Approved. The freelancer can now withdraw their payment.')
  const cancel = simple('cancel', 'Cancelling', 'Cancelled. Your USDC is ready to withdraw.')
  const decline = simple('decline', 'Declining', 'Declined. The client can withdraw the refund.')
  const claim = simple('claimAfterTimeout', 'Releasing payment', 'Payment released. You can withdraw it now.')
  const settleStale = simple('resolveStale', 'Settling', 'Settled in the freelancer\'s favor because the arbiter did not respond in time.')

  const withdraw = useCallback(
    () =>
      run('Withdrawing', 'Withdrawn to your wallet.', async () => {
        const { escrow } = await requireReady()
        const hash = await send(escrow, 'withdraw')
        await refresh()
        return hash
      }),
    [refresh, requireReady, run, send],
  )

  return { busy, fund, submitWork, approve, cancel, decline, claim, withdraw, dispute, resolve, settleStale }
}
