import { Link } from 'react-router-dom'
import type { Job } from '@/lib/api'
import { shortAddress, timeAgo } from '@/lib/format'
import ui from '@/styles/ui.module.scss'
import { StatusBadge } from './StatusBadge'
import { BudgetRange } from './UsdcAmount'
import s from './JobCard.module.scss'

export function JobCard({ job }: { job: Job }) {
  return (
    <Link to={`/jobs/${job.id}`} className={s.card}>
      <div className={s.top}>
        <h3 className={s.title}>{job.title}</h3>
        <StatusBadge status={job.status} />
      </div>
      <p className={s.excerpt}>{job.description}</p>
      <BudgetRange min={job.budgetMin} max={job.budgetMax} />
      <div className={s.meta}>
        <span className={ui.chip}>{job.category}</span>
        <span>{job.bidCount ?? 0} bids</span>
        <span>{job.clientName || shortAddress(job.clientAddress)}</span>
        <span>{timeAgo(job.createdAt)}</span>
      </div>
    </Link>
  )
}

export function JobGrid({ children }: { children: React.ReactNode }) {
  return <div className={s.grid}>{children}</div>
}
