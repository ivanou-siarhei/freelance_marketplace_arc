import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gavel } from 'lucide-react'
import { api, type DisputeQueueItem } from '@/lib/api'
import { shortAddress } from '@/lib/format'
import { useEscrowActions } from '@/hooks/useEscrowActions'
import { useIsArbiter } from '@/hooks/useArbiter'
import { useSession } from '@/hooks/useSession'
import { ConnectGate } from '@/components/ConnectGate'
import { DeliveryCard } from '@/components/DeliveryCard'
import { DisputeCard } from '@/components/DisputeCard'
import { ResolvePanel } from '@/components/ResolvePanel'
import { UsdcAmount } from '@/components/UsdcAmount'
import ui from '@/styles/ui.module.scss'

function QueueItem({ item, actions, onChanged }: { item: DisputeQueueItem; actions: ReturnType<typeof useEscrowActions>; onChanged: () => Promise<void> }) {
  const { dispute, escrow } = item
  return (
    <div className={ui.stack} style={{ gap: 16 }}>
      <section className={`${ui.card} ${ui.stack}`}>
        <div className={ui.spread}>
          <Link to={`/jobs/${dispute.jobId}`} className={ui.link} style={{ fontSize: 20, fontWeight: 600 }}>
            {item.jobTitle}
          </Link>
          <UsdcAmount raw={escrow.amount} size={20} />
        </div>
        <div className={ui.row}>
          <span className={ui.chip}>Client {shortAddress(escrow.clientAddress)}</span>
          <span className={ui.chip}>Freelancer {shortAddress(escrow.freelancerAddress)}</span>
        </div>
        <p className={ui.muted} style={{ whiteSpace: 'pre-wrap' }}>
          {item.jobDescription}
        </p>
      </section>
      {item.delivery ? <DeliveryCard delivery={item.delivery} /> : null}
      <DisputeCard jobId={dispute.jobId} dispute={dispute} role="visitor" isArbiter onChanged={onChanged} />
      {dispute.status === 'open' ? (
        <section className={ui.card}>
          <ResolvePanel jobId={dispute.jobId} escrow={escrow} actions={actions} />
        </section>
      ) : null}
    </div>
  )
}

function Queue() {
  const { address } = useSession()
  const queryClient = useQueryClient()
  const actions = useEscrowActions()
  const query = useQuery({
    queryKey: ['disputes', address],
    queryFn: () => api<{ disputes: DisputeQueueItem[] }>('/disputes'),
    refetchInterval: 15_000,
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['disputes'] })
    await queryClient.invalidateQueries({ queryKey: ['job'] })
  }

  if (query.isLoading) return <div className={ui.skeleton} style={{ minHeight: 240 }} />
  if (query.isError) return <div className={`${ui.notice} ${ui.noticeError}`}>Could not load disputes. {query.error.message}</div>

  const open = (query.data?.disputes ?? []).filter((item) => item.dispute.status === 'open')
  const settled = (query.data?.disputes ?? []).filter((item) => item.dispute.status === 'resolved')

  return (
    <div className={ui.stack} style={{ gap: 32 }}>
      <section className={ui.stack} style={{ gap: 20 }}>
        <h2>Waiting for your decision ({open.length})</h2>
        {open.length === 0 ? (
          <div className={`${ui.card} ${ui.empty}`}>
            <Gavel size={28} aria-hidden />
            <h3>Nothing to decide right now</h3>
            <p>When a client disputes a delivery, it shows up here with both sides of the story.</p>
          </div>
        ) : (
          open.map((item) => <QueueItem key={item.dispute.jobId} item={item} actions={actions} onChanged={refresh} />)
        )}
      </section>
      {settled.length > 0 ? (
        <section className={ui.stack} style={{ gap: 20 }}>
          <h2>Recently settled ({settled.length})</h2>
          {settled.map((item) => (
            <QueueItem key={item.dispute.jobId} item={item} actions={actions} onChanged={refresh} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

export function ArbiterPage() {
  const isArbiter = useIsArbiter()
  return (
    <div className={ui.page} style={{ maxWidth: 820 }}>
      <div className={ui.pageHead}>
        <h1>Arbiter</h1>
        <p>Review disputed deliveries and decide how the escrow is split. Disputes the arbiter does not settle in time pay the freelancer in full.</p>
      </div>
      <ConnectGate reason="Connect the arbiter wallet to review disputes.">
        {isArbiter ? (
          <Queue />
        ) : (
          <div className={`${ui.card} ${ui.empty}`}>
            <h3>This page is for the arbiter wallet</h3>
            <p>The connected wallet is not the arbiter of the escrow contract, so there is nothing to review here.</p>
          </div>
        )}
      </ConnectGate>
    </div>
  )
}
