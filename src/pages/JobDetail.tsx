import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Bid, type JobDetailResponse } from '@/lib/api'
import { shortAddress, timeAgo } from '@/lib/format'
import { useEscrowActions } from '@/hooks/useEscrowActions'
import { useSession } from '@/hooks/useSession'
import { StatusBadge } from '@/components/StatusBadge'
import { BudgetRange } from '@/components/UsdcAmount'
import { BidList } from '@/components/BidList'
import { DeliveryCard } from '@/components/DeliveryCard'
import { DisputeCard } from '@/components/DisputeCard'
import { EscrowPanel } from '@/components/EscrowPanel'
import { ButtonLink } from '@/components/Button'
import ui from '@/styles/ui.module.scss'
import s from './JobDetail.module.scss'

export function JobDetail() {
  const { id = '' } = useParams()
  const { address } = useSession()
  const queryClient = useQueryClient()
  const actions = useEscrowActions()
  const [accepting, setAccepting] = useState(false)

  const query = useQuery({
    queryKey: ['job', id, address],
    queryFn: () => api<JobDetailResponse>(`/jobs/${id}`),
    refetchInterval: 10_000,
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['job', id] })
    await queryClient.invalidateQueries({ queryKey: ['jobs'] })
  }

  async function acceptAndFund(bid: Bid) {
    setAccepting(true)
    try {
      await api(`/jobs/${id}/accept`, { method: 'POST', body: { bidId: bid.id } })
      const fresh = await api<JobDetailResponse>(`/jobs/${id}`)
      await refresh()
      if (fresh.fundingTerms) await actions.fund(id, fresh.fundingTerms)
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not accept the bid.')
    } finally {
      setAccepting(false)
    }
  }

  if (query.isLoading) {
    return (
      <div className={ui.page}>
        <div className={ui.skeleton} style={{ minHeight: 320 }} />
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <div className={ui.page}>
        <div className={`${ui.card} ${ui.empty}`}>
          <h3>We could not find that job</h3>
          <p>{query.error?.message ?? 'It may have been removed.'}</p>
          <ButtonLink to="/">Browse jobs</ButtonLink>
        </div>
      </div>
    )
  }

  const detail = query.data
  const { job, role } = detail
  const showBids = role === 'client'

  return (
    <div className={ui.page}>
      <Link to="/" className={`${ui.link} ${ui.row}`} style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} aria-hidden /> All jobs
      </Link>
      <div className={s.layout}>
        <div className={ui.stack} style={{ gap: 24 }}>
          <section className={`${ui.card} ${s.head}`}>
            <div className={ui.row}>
              <StatusBadge status={job.status} />
              <span className={ui.chip}>{job.category}</span>
              <span className={ui.muted}>{timeAgo(job.createdAt)}</span>
            </div>
            <h1>{job.title}</h1>
            <BudgetRange min={job.budgetMin} max={job.budgetMax} />
            <p className={ui.muted}>
              Posted by{' '}
              <Link className={ui.link} to={`/profile/${job.clientAddress}`}>
                {job.clientName || shortAddress(job.clientAddress)}
              </Link>
              {role === 'client' ? ' (you)' : ''}
            </p>
            <p className={s.description}>{job.description}</p>
          </section>

          {detail.delivery ? <DeliveryCard delivery={detail.delivery} /> : null}

          {detail.dispute && detail.dispute.status !== 'prepared' ? (
            <DisputeCard jobId={job.id} dispute={detail.dispute} role={role} isArbiter={detail.isArbiter} onChanged={refresh} />
          ) : null}

          {showBids ? (
            <section className={`${ui.card} ${ui.stack}`}>
              <h3>Bids</h3>
              <BidList job={job} bids={detail.bids} busy={accepting || actions.busy !== null} onAccept={(bid) => void acceptAndFund(bid)} />
            </section>
          ) : null}
        </div>

        <div className={s.aside}>
          <EscrowPanel detail={detail} actions={actions} onChanged={refresh} />
        </div>
      </div>
    </div>
  )
}
