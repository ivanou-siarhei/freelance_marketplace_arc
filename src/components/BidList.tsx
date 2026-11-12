import { Link } from 'react-router-dom'
import type { Bid, Job } from '@/lib/api'
import { formatDuration, shortAddress, timeAgo } from '@/lib/format'
import ui from '@/styles/ui.module.scss'
import s from '@/pages/JobDetail.module.scss'
import { Button } from './Button'
import { UsdcAmount } from './UsdcAmount'

interface BidListProps {
  job: Job
  bids: Bid[]
  busy: boolean
  onAccept: (bid: Bid) => void
}

/** The client's view of every bid on their job. */
export function BidList({ job, bids, busy, onAccept }: BidListProps) {
  const visible = bids.filter((bid) => bid.status !== 'withdrawn')
  if (visible.length === 0) {
    return (
      <div className={`${ui.inner} ${ui.muted}`}>No bids yet. Freelancers will appear here as they bid.</div>
    )
  }
  return (
    <div className={ui.stack}>
      {visible.map((bid) => (
        <article key={bid.id} className={s.bidItem}>
          <div className={s.bidHead}>
            <Link to={`/profile/${bid.freelancerAddress}`} className={ui.link}>
              {bid.freelancerName || shortAddress(bid.freelancerAddress)}
            </Link>
            <UsdcAmount raw={bid.amount} />
          </div>
          <p className={s.proposal}>{bid.proposal}</p>
          <div className={ui.row}>
            <span className={ui.chip}>Delivers in {formatDuration(bid.deliverySeconds)}</span>
            <span className={ui.muted}>{timeAgo(bid.updatedAt)}</span>
            {bid.status === 'accepted' ? <span className={ui.chip}>Accepted</span> : null}
            {bid.status === 'funded' ? <span className={ui.chip}>Hired</span> : null}
            {bid.status === 'rejected' ? <span className={ui.chip}>Not selected</span> : null}
          </div>
          {job.status === 'open' && bid.status === 'open' ? (
            <Button small loading={busy} onClick={() => onAccept(bid)}>
              Accept and fund
            </Button>
          ) : null}
        </article>
      ))}
    </div>
  )
}
