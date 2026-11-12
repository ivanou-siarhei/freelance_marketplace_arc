import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Bid, type Job } from '@/lib/api'
import { MAX_BID_DELIVERY_SECONDS } from '@/lib/categories'
import { formatDuration, formatUsdcAmount, tryParseUsdc } from '@/lib/format'
import { useAppConfig } from '@/hooks/useAppConfig'
import ui from '@/styles/ui.module.scss'
import s from '@/pages/JobDetail.module.scss'
import { Button } from './Button'
import { ConnectGate } from './ConnectGate'

const UNITS = [
  { id: 'minutes', label: 'Minutes', seconds: 60 },
  { id: 'hours', label: 'Hours', seconds: 3600 },
  { id: 'days', label: 'Days', seconds: 86400 },
] as const

function initialDelivery(bid?: Bid): { value: string; unit: (typeof UNITS)[number]['id'] } {
  if (!bid) return { value: '7', unit: 'days' }
  if (bid.deliverySeconds % 86400 === 0) return { value: String(bid.deliverySeconds / 86400), unit: 'days' }
  if (bid.deliverySeconds % 3600 === 0) return { value: String(bid.deliverySeconds / 3600), unit: 'hours' }
  return { value: String(Math.round(bid.deliverySeconds / 60)), unit: 'minutes' }
}

export function BidForm({ job, myBid, onChanged }: { job: Job; myBid?: Bid; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient()
  const { params } = useAppConfig()
  const start = initialDelivery(myBid)
  const [amount, setAmount] = useState(myBid ? formatUsdcAmount(myBid.amount).replace(/,/g, '') : '')
  const [value, setValue] = useState(start.value)
  const [unit, setUnit] = useState<(typeof UNITS)[number]['id']>(start.unit)
  const [proposal, setProposal] = useState(myBid?.proposal ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const minDelivery = params?.minDeliveryPeriod ?? 60
  const units = UNITS.filter((item) => item.seconds >= 3600 || minDelivery < 3600)
  const locked = myBid?.status === 'accepted' || myBid?.status === 'funded'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const raw = tryParseUsdc(amount)
    const unitSeconds = UNITS.find((item) => item.id === unit)?.seconds ?? 86400
    const seconds = Math.round(Number(value) * unitSeconds)
    if (!raw) return setError('Enter your price in USDC.')
    if (!Number.isFinite(seconds) || seconds < minDelivery) {
      return setError(`Delivery time must be at least ${formatDuration(minDelivery)}.`)
    }
    if (seconds > MAX_BID_DELIVERY_SECONDS) return setError('Delivery time cannot be longer than 89 days.')
    setSaving(true)
    try {
      await api(`/jobs/${job.id}/bids`, {
        method: 'POST',
        body: { amount: raw.toString(), deliverySeconds: seconds, proposal },
      })
      toast.success(myBid ? 'Bid updated.' : 'Bid placed. The client will be notified of it on their dashboard.')
      await queryClient.invalidateQueries({ queryKey: ['jobs'] })
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your bid.')
    } finally {
      setSaving(false)
    }
  }

  async function withdraw() {
    setSaving(true)
    try {
      await api(`/jobs/${job.id}/bids/mine`, { method: 'DELETE' })
      toast.success('Bid withdrawn.')
      await queryClient.invalidateQueries({ queryKey: ['jobs'] })
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not withdraw your bid.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConnectGate reason="Connect a wallet to place a bid. Payment arrives in this wallet.">
      <form className={ui.stack} onSubmit={(event) => void onSubmit(event)}>
        <h3>{myBid ? 'Your bid' : 'Place a bid'}</h3>
        {locked ? (
          <div className={`${ui.notice} ${ui.noticeOk}`}>
            Your bid was accepted, so it can no longer be changed or withdrawn. If the client never funds it, they can cancel the acceptance.
          </div>
        ) : null}
        <label className={ui.field}>
          <span>Your price</span>
          <div className={ui.amountInput}>
            <input className={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" required disabled={locked} />
            <em>USDC</em>
          </div>
        </label>
        <label className={ui.field}>
          <span>Delivery time</span>
          <div className={s.amountRow}>
            <input className={ui.input} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} required disabled={locked} />
            <select className={ui.select} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} disabled={locked}>
              {units.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className={ui.field}>
          <span>Proposal</span>
          <textarea className={ui.textarea} value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="Why you are a good fit and how you will do it." required minLength={10} maxLength={3000} disabled={locked} />
        </label>
        <small className={ui.muted}>
          After you deliver, the client reviews for {formatDuration(job.reviewPeriodSeconds)}. If they do not respond, the payment is released to you.
        </small>
        {error ? <div className={`${ui.notice} ${ui.noticeError}`}>{error}</div> : null}
        {!locked ? (
          <div className={ui.row}>
            <Button type="submit" loading={saving}>
              {myBid ? 'Update bid' : 'Place bid'}
            </Button>
            {myBid && myBid.status === 'open' ? (
              <Button variant="ghost" disabled={saving} onClick={() => void withdraw()}>
                Withdraw bid
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
    </ConnectGate>
  )
}
