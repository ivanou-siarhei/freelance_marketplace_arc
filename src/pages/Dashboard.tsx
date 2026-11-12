import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { api, type Anomaly, type Escrow, type Job } from '@/lib/api'
import { shortAddress } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import { ConnectGate } from '@/components/ConnectGate'
import { EarningsCard } from '@/components/EarningsCard'
import { JobCard, JobGrid } from '@/components/JobCard'
import { ButtonLink } from '@/components/Button'
import { UsdcAmount } from '@/components/UsdcAmount'
import ui from '@/styles/ui.module.scss'
import s from './Dashboard.module.scss'

type Tab = 'jobs' | 'bids' | 'escrows'

const ESCROW_LABEL: Record<string, string> = {
  funded: 'In progress',
  submitted: 'In review',
  disputed: 'In dispute',
  released: 'Paid',
  resolved: 'Settled',
  cancelled: 'Refunded',
}

const ANOMALY_TEXT: Record<string, string> = {
  acceptance_not_active:
    'You funded this job after the acceptance had been cancelled or had expired, so the app did not start the job.',
  amount_mismatch: 'The funded amount did not match the accepted bid.',
  freelancer_mismatch: 'The freelancer on this escrow did not match the accepted bid.',
  deadline_too_short: 'The delivery date on this escrow was shorter than the freelancer agreed to.',
  review_period_mismatch: 'The review window on this escrow did not match the job.',
  client_mismatch: 'This escrow was funded from a different wallet than the job owner.',
  duplicate_escrow: 'This job already had a funded escrow.',
  unknown_job_ref: 'This escrow did not match any job in the app.',
}

function EscrowList({ escrows, me }: { escrows: Escrow[]; me: string }) {
  if (escrows.length === 0) {
    return (
      <div className={`${ui.card} ${ui.empty}`}>
        <h3>No active work yet</h3>
        <p>Funded jobs show up here for both the client and the freelancer.</p>
      </div>
    )
  }
  return (
    <div className={ui.stack}>
      {escrows.map((escrow) => (
        <Link key={escrow.escrowId} to={`/jobs/${escrow.jobId}`} className={s.escrowRow}>
          <div className={ui.stack} style={{ gap: 2 }}>
            <strong>{escrow.jobTitle}</strong>
            <span className={ui.muted}>
              {escrow.clientAddress === me ? `You hired ${shortAddress(escrow.freelancerAddress)}` : `Client ${shortAddress(escrow.clientAddress)}`}
            </span>
          </div>
          <div className={ui.row}>
            <UsdcAmount raw={escrow.amount} />
            <span className={ui.chip}>{ESCROW_LABEL[escrow.status] ?? escrow.status}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function Dashboard_() {
  const { address } = useSession()
  const [tab, setTab] = useState<Tab>('jobs')

  const myJobs = useQuery({ queryKey: ['jobs', 'mine-client', address], queryFn: () => api<{ jobs: Job[] }>('/jobs?mine=client&status=all') })
  const myBids = useQuery({ queryKey: ['jobs', 'mine-bidder', address], queryFn: () => api<{ jobs: Job[] }>('/jobs?mine=bidder&status=all') })
  const escrows = useQuery({ queryKey: ['escrows', address], queryFn: () => api<{ escrows: Escrow[] }>('/me/escrows'), refetchInterval: 15_000 })
  const anomalies = useQuery({ queryKey: ['anomalies', address], queryFn: () => api<{ anomalies: Anomaly[] }>('/me/anomalies') })

  const jobsView = tab === 'jobs' ? myJobs : myBids
  const tabs: { id: Tab; label: string }[] = [
    { id: 'jobs', label: `My jobs${myJobs.data ? ` (${myJobs.data.jobs.length})` : ''}` },
    { id: 'bids', label: `My bids${myBids.data ? ` (${myBids.data.jobs.length})` : ''}` },
    { id: 'escrows', label: `Active work${escrows.data ? ` (${escrows.data.escrows.length})` : ''}` },
  ]

  return (
    <div className={ui.stack} style={{ gap: 24 }}>
      <EarningsCard />

      {anomalies.data?.anomalies.map((item) => (
        <div key={`${item.txHash}-${item.reason}`} className={`${ui.notice} ${ui.noticeWarn}`}>
          <TriangleAlert size={18} aria-hidden />
          <div>
            <strong>Unmatched escrow{item.jobTitle ? ` for "${item.jobTitle}"` : ''}</strong>
            <div>{ANOMALY_TEXT[item.reason] ?? 'An escrow you funded did not match the app records.'}</div>
            <div className={ui.muted}>
              Your USDC is safe in the contract. The freelancer can decline to refund you, or you can cancel after the delivery date passes.
            </div>
          </div>
        </div>
      ))}

      <div className={s.tabs} role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`${s.tab} ${tab === item.id ? s.tabOn : ''}`} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'escrows' ? (
        escrows.isLoading ? (
          <div className={ui.skeleton} />
        ) : (
          <EscrowList escrows={escrows.data?.escrows ?? []} me={address ?? ''} />
        )
      ) : jobsView.isLoading ? (
        <div className={ui.skeleton} />
      ) : jobsView.data && jobsView.data.jobs.length > 0 ? (
        <JobGrid>
          {jobsView.data.jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </JobGrid>
      ) : (
        <div className={`${ui.card} ${ui.empty}`}>
          <h3>{tab === 'jobs' ? 'You have not posted a job' : 'You have not placed a bid'}</h3>
          <p>{tab === 'jobs' ? 'Post a job to start receiving bids.' : 'Browse open jobs and bid on one that fits.'}</p>
          <ButtonLink to={tab === 'jobs' ? '/post' : '/'}>{tab === 'jobs' ? 'Post a job' : 'Browse jobs'}</ButtonLink>
        </div>
      )}
    </div>
  )
}

export function Dashboard() {
  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <h1>Dashboard</h1>
        <p>Your jobs, your bids, and your money in one place.</p>
      </div>
      <ConnectGate reason="Connect your wallet to see your jobs, bids and earnings.">
        <Dashboard_ />
      </ConnectGate>
    </div>
  )
}
