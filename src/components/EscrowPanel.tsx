import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, type JobDetailResponse } from '@/lib/api'
import { formatCountdown, formatDateTime, formatDuration, formatUsdcAmount, shortAddress } from '@/lib/format'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ARC_CHAIN_ID } from '@/lib/escrow'
import { useAccount } from 'wagmi'
import { useAppConfig } from '@/hooks/useAppConfig'
import { useUsdcBalance } from '@/hooks/useBalances'
import { useEscrowActions } from '@/hooks/useEscrowActions'
import { useNow } from '@/hooks/useNow'
import ui from '@/styles/ui.module.scss'
import s from '@/pages/JobDetail.module.scss'
import { Button } from './Button'
import { DeliveryForm } from './DeliveryForm'
import { BidForm } from './BidForm'
import { DisputeForm } from './DisputeForm'
import { ResolvePanel } from './ResolvePanel'
import { UsdcAmount } from './UsdcAmount'

interface EscrowPanelProps {
  detail: JobDetailResponse
  actions: ReturnType<typeof useEscrowActions>
  onChanged: () => Promise<void>
}

function Countdown({ target, label }: { target: string; label: string }) {
  const now = useNow()
  const ms = new Date(target).getTime()
  return (
    <div className={ui.stack} style={{ gap: 4 }}>
      <span className={ui.label}>{label}</span>
      <span className={s.countdown}>{ms > now ? formatCountdown(ms, now) : 'Ready'}</span>
      <span className={ui.muted}>{formatDateTime(target)}</span>
    </div>
  )
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a className={ui.link} href={buildTxExplorerUrl(ARC_CHAIN_ID, hash)} target="_blank" rel="noopener noreferrer">
      View latest transaction on the explorer
    </a>
  )
}

function LowBalanceNotice({ needed }: { needed: bigint }) {
  const { address } = useAccount()
  const { data } = useUsdcBalance(address)
  if (data === undefined || data >= needed) return null
  return (
    <div className={`${ui.notice} ${ui.noticeWarn}`}>
      <span>
        Your wallet has {formatUsdcAmount(data)} USDC, but this escrow needs {formatUsdcAmount(needed)}.{' '}
        <a className={ui.link} href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
          Get test USDC
        </a>
      </span>
    </div>
  )
}

export function EscrowPanel({ detail, actions, onChanged }: EscrowPanelProps) {
  const { job, escrow, role, fundingTerms, bids } = detail
  const { params } = useAppConfig()
  const now = useNow()
  const [working, setWorking] = useState(false)
  const busy = actions.busy !== null || working
  const myBid = role !== 'client' ? bids.find((bid) => bid.status !== 'withdrawn' && bid.status !== 'rejected') : undefined

  async function apiAction(path: string, success: string) {
    setWorking(true)
    try {
      await api(path, { method: 'POST', body: {} })
      toast.success(success)
      await onChanged()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setWorking(false)
    }
  }

  const header = (
    <div className={ui.spread}>
      <h3>Payment protection</h3>
      <ShieldCheck size={20} aria-hidden />
    </div>
  )

  // ---- open ----
  if (job.status === 'open') {
    if (role === 'client') {
      return (
        <aside className={`${ui.card} ${ui.stack}`}>
          {header}
          <p className={ui.muted}>
            {detail.job.bidCount ? `You have ${detail.job.bidCount} bid(s). ` : 'Waiting for bids. '}
            Pick a freelancer below. Your USDC stays in your wallet until you accept a bid and fund the escrow.
          </p>
          <Button variant="danger" loading={working} onClick={() => void apiAction(`/jobs/${job.id}/cancel`, 'Job cancelled.')}>
            Cancel this job
          </Button>
        </aside>
      )
    }
    return (
      <aside className={`${ui.card} ${ui.stack}`}>
        <BidForm key={myBid?.updatedAt ?? 'new'} job={job} myBid={myBid} onChanged={onChanged} />
      </aside>
    )
  }

  // ---- accepted, waiting for funding ----
  if (job.status === 'awaiting_funding') {
    const expires = job.fundingExpiresAt
    if (role === 'client' && fundingTerms) {
      return (
        <aside className={`${ui.card} ${ui.stack}`}>
          {header}
          <div className={ui.inner}>
            <div className={ui.label}>Escrow amount</div>
            <UsdcAmount raw={fundingTerms.amount} size={22} />
            <div className={ui.muted} style={{ marginTop: 6 }}>
              For {shortAddress(fundingTerms.freelancer)}, delivery in {formatDuration(fundingTerms.deliverySeconds)}
            </div>
          </div>
          {expires ? <Countdown target={expires} label="Acceptance expires in" /> : null}
          <LowBalanceNotice needed={BigInt(fundingTerms.amount)} />
          <Button loading={actions.busy === 'Funding escrow'} disabled={busy && actions.busy !== 'Funding escrow'} onClick={() => void actions.fund(job.id, fundingTerms)}>
            Fund escrow
          </Button>
          <Button variant="ghost" loading={working} disabled={actions.busy !== null} onClick={() => void apiAction(`/jobs/${job.id}/unaccept`, 'Acceptance cancelled. The job is open again.')}>
            Cancel acceptance
          </Button>
          <small className={ui.muted}>
            Your wallet signs a USDC permission and funds the escrow in one step when your wallet supports it. The money is held by the contract, not by ArcWork.
          </small>
        </aside>
      )
    }
    return (
      <aside className={`${ui.card} ${ui.stack}`}>
        {header}
        <div className={`${ui.notice} ${ui.noticeWarn}`}>
          {myBid?.status === 'accepted'
            ? 'Your bid was accepted. Work can start once the client funds the escrow.'
            : 'A bid has been accepted and is waiting for the client to fund the escrow.'}
        </div>
        {expires ? <Countdown target={expires} label="Acceptance expires in" /> : null}
      </aside>
    )
  }

  // ---- escrow exists ----
  if (!escrow) {
    return (
      <aside className={`${ui.card} ${ui.stack}`}>
        {header}
        <p className={ui.muted}>This job is {job.status}.</p>
      </aside>
    )
  }

  const deadlineMs = escrow.deliveryDeadline ? new Date(escrow.deliveryDeadline).getTime() : 0
  const reviewEndsMs = escrow.reviewEndsAt ? new Date(escrow.reviewEndsAt).getTime() : 0
  const amountBlock = (
    <div className={ui.inner}>
      <div className={ui.label}>Held in escrow</div>
      <UsdcAmount raw={escrow.amount} size={22} />
    </div>
  )

  if (escrow.status === 'funded') {
    return (
      <aside className={`${ui.card} ${ui.stack}`}>
        {header}
        {amountBlock}
        {escrow.deliveryDeadline ? <Countdown target={escrow.deliveryDeadline} label="Delivery due in" /> : null}
        {role === 'freelancer' ? (
          <>
            <DeliveryForm
              escrow={escrow}
              busy={actions.busy === 'Submitting work'}
              disabled={actions.busy !== null && actions.busy !== 'Submitting work'}
              onSubmit={(note, link) => void actions.submitWork(job.id, escrow, note, link)}
            />
            <Button variant="ghost" loading={actions.busy === 'Declining'} disabled={actions.busy !== null && actions.busy !== 'Declining'} onClick={() => void actions.decline(job.id, escrow)}>
              Decline this job and refund the client
            </Button>
          </>
        ) : role === 'client' ? (
          <>
            <p className={ui.muted}>The freelancer is working. You can cancel and get a refund only after the delivery date passes without a submission.</p>
            <Button variant="danger" loading={actions.busy === 'Cancelling'} disabled={now <= deadlineMs || (actions.busy !== null && actions.busy !== 'Cancelling')} onClick={() => void actions.cancel(job.id, escrow)}>
              {now <= deadlineMs ? 'Cancel available after the delivery date' : 'Cancel and refund'}
            </Button>
          </>
        ) : (
          <p className={ui.muted}>Funded and in progress.</p>
        )}
        <TxLink hash={escrow.lastTx} />
      </aside>
    )
  }

  if (escrow.status === 'submitted') {
    const reviewOver = now >= reviewEndsMs
    return (
      <aside className={`${ui.card} ${ui.stack}`}>
        {header}
        {amountBlock}
        {escrow.reviewEndsAt ? <Countdown target={escrow.reviewEndsAt} label={reviewOver ? 'Review window ended' : 'Review window ends in'} /> : null}
        {role === 'client' ? (
          <>
            <Button loading={actions.busy === 'Approving'} disabled={actions.busy !== null && actions.busy !== 'Approving'} onClick={() => void actions.approve(job.id, escrow)}>
              Approve and release payment
            </Button>
            {!reviewOver ? <DisputeForm jobId={job.id} escrow={escrow} actions={actions} /> : null}
            <small className={ui.muted}>
              Review the delivered work, then approve. If the window ends with no response, the payment is released to the freelancer automatically.
            </small>
          </>
        ) : null}
        {role !== 'client' && !reviewOver ? (
          <p className={ui.muted}>Work was submitted. The client is reviewing it. If they do not respond by the end of the window, you can release your payment.</p>
        ) : null}
        {reviewOver ? (
          <Button loading={actions.busy === 'Releasing payment'} disabled={actions.busy !== null && actions.busy !== 'Releasing payment'} onClick={() => void actions.claim(job.id, escrow)}>
            Release payment to the freelancer
          </Button>
        ) : null}
        <TxLink hash={escrow.lastTx} />
      </aside>
    )
  }

  if (escrow.status === 'disputed') {
    const staleAtMs = escrow.disputedAt && params ? new Date(escrow.disputedAt).getTime() + params.arbiterTimeout * 1000 : 0
    const staleReady = staleAtMs > 0 && now >= staleAtMs
    return (
      <aside className={`${ui.card} ${ui.stack}`}>
        {header}
        {amountBlock}
        <div className={`${ui.notice} ${ui.noticeWarn}`}>The funds are frozen while the arbiter reviews this dispute.</div>
        {detail.isArbiter ? <ResolvePanel jobId={job.id} escrow={escrow} actions={actions} /> : null}
        {staleAtMs > 0 ? (
          <>
            <Countdown target={new Date(staleAtMs).toISOString()} label={staleReady ? 'Arbiter response time ended' : 'Arbiter has until'} />
            <small className={ui.muted}>
              If the arbiter does not decide by then, anyone can settle the dispute and the whole amount goes to the freelancer.
            </small>
            {staleReady ? (
              <Button loading={actions.busy === 'Settling'} disabled={actions.busy !== null && actions.busy !== 'Settling'} onClick={() => void actions.settleStale(job.id, escrow)}>
                Settle for the freelancer
              </Button>
            ) : null}
          </>
        ) : null}
        <TxLink hash={escrow.lastTx} />
      </aside>
    )
  }

  const doneText: Record<string, string> = {
    released: 'Payment was released to the freelancer.',
    resolved: 'This dispute was settled. See the details on the left.',
    cancelled: 'The escrow was cancelled and refunded to the client.',
  }
  return (
    <aside className={`${ui.card} ${ui.stack}`}>
      {header}
      {amountBlock}
      <div className={`${ui.notice} ${ui.noticeOk}`}>{doneText[escrow.status] ?? 'Finished.'}</div>
      <p className={ui.muted}>
        Payouts wait in the contract until the recipient withdraws them. <Link className={ui.link} to="/dashboard">Open your dashboard</Link> to withdraw.
      </p>
      <TxLink hash={escrow.lastTx} />
    </aside>
  )
}
