import { TokenUSDC } from '@web3icons/react'
import { formatUsdcAmount } from '@/lib/format'
import s from '@/styles/ui.module.scss'

export function UsdcAmount({ raw, size = 18 }: { raw: string | bigint; size?: number }) {
  return (
    <span className={s.amount}>
      <TokenUSDC variant="branded" size={size} />
      {formatUsdcAmount(raw)}
      <span className={s.muted} style={{ fontWeight: 500, fontSize: '0.8em' }}>
        USDC
      </span>
    </span>
  )
}

export function BudgetRange({ min, max }: { min: string; max: string }) {
  if (min === max) return <UsdcAmount raw={min} />
  return (
    <span className={s.amount}>
      <TokenUSDC variant="branded" size={18} />
      {formatUsdcAmount(min)} to {formatUsdcAmount(max)}
      <span className={s.muted} style={{ fontWeight: 500, fontSize: '0.8em' }}>
        USDC
      </span>
    </span>
  )
}
