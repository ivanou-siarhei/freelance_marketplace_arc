import { useAccount } from 'wagmi'
import { Wallet } from 'lucide-react'
import { useClaimable } from '@/hooks/useBalances'
import { useEscrowActions } from '@/hooks/useEscrowActions'
import ui from '@/styles/ui.module.scss'
import s from '@/pages/Dashboard.module.scss'
import { Button } from './Button'
import { UsdcAmount } from './UsdcAmount'

/** Payouts credited to your wallet inside the escrow contract. You withdraw them to your wallet. */
export function EarningsCard() {
  const { address } = useAccount()
  const { data, isLoading } = useClaimable(address)
  const { busy, withdraw } = useEscrowActions()
  const claimable = (data as bigint | undefined) ?? 0n

  return (
    <section className={`${ui.card} ${s.earnings}`}>
      <div className={ui.stack} style={{ gap: 6 }}>
        <span className={ui.label}>Ready to withdraw</span>
        {isLoading ? <div className={ui.skeleton} style={{ minHeight: 40, width: 180 }} /> : <UsdcAmount raw={claimable} size={28} />}
        <small className={ui.muted}>
          Payments, refunds and settlements wait here until you withdraw them. Withdrawing sends USDC to your connected wallet.
        </small>
      </div>
      <Button loading={busy === 'Withdrawing'} disabled={claimable === 0n} onClick={() => void withdraw()}>
        <Wallet size={16} aria-hidden />
        Withdraw
      </Button>
    </section>
  )
}
