import { useState } from 'react'
import type { Escrow } from '@/lib/api'
import { formatUsdcAmount } from '@/lib/format'
import type { useEscrowActions } from '@/hooks/useEscrowActions'
import ui from '@/styles/ui.module.scss'
import { Button } from './Button'
import s from './ResolvePanel.module.scss'

interface ResolvePanelProps {
  jobId: string
  escrow: Escrow
  actions: ReturnType<typeof useEscrowActions>
}

/** The arbiter's decision: what share of the escrow the freelancer receives. The client gets the rest. */
export function ResolvePanel({ jobId, escrow, actions }: ResolvePanelProps) {
  const [percent, setPercent] = useState(50)
  const total = BigInt(escrow.amount)
  // Whole percents only, rounded down for the freelancer. The client receives the exact remainder.
  const freelancerShare = (total * BigInt(percent)) / 100n
  const clientShare = total - freelancerShare
  const working = actions.busy === 'Settling'

  return (
    <div className={ui.stack}>
      <h3>Decide the split</h3>
      <div className={s.split}>
        <div className={s.share}>
          <span className={ui.label}>Freelancer</span>
          <strong>{formatUsdcAmount(freelancerShare)}</strong>
          <span className={ui.muted}>{percent}%</span>
        </div>
        <div className={s.share}>
          <span className={ui.label}>Client</span>
          <strong>{formatUsdcAmount(clientShare)}</strong>
          <span className={ui.muted}>{100 - percent}%</span>
        </div>
      </div>
      <input
        className={s.slider}
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => setPercent(Number(event.target.value))}
        aria-label="Share of the escrow paid to the freelancer"
      />
      <div className={s.presets}>
        <Button small variant="secondary" onClick={() => setPercent(0)}>
          All to client
        </Button>
        <Button small variant="secondary" onClick={() => setPercent(50)}>
          Split 50/50
        </Button>
        <Button small variant="secondary" onClick={() => setPercent(100)}>
          All to freelancer
        </Button>
      </div>
      <Button loading={working} disabled={actions.busy !== null && !working} onClick={() => void actions.resolve(jobId, escrow, freelancerShare)}>
        Settle this dispute
      </Button>
      <small className={ui.muted}>
        This is final. Both sides can withdraw their share right after your transaction confirms. Your wallet must not be the client or the freelancer on this job.
      </small>
    </div>
  )
}
