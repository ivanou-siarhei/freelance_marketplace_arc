import { useState, type FormEvent } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Dispute } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import ui from '@/styles/ui.module.scss'
import s from '@/pages/JobDetail.module.scss'
import { Button } from './Button'
import { UsdcAmount } from './UsdcAmount'

interface DisputeCardProps {
  jobId: string
  dispute: Dispute
  role: 'client' | 'freelancer' | 'visitor'
  isArbiter: boolean
  onChanged: () => Promise<void>
}

function FreelancerResponseForm({ jobId, dispute, onChanged }: { jobId: string; dispute: Dispute; onChanged: () => Promise<void> }) {
  const [response, setResponse] = useState(dispute.freelancerResponse)
  const [link, setLink] = useState(dispute.freelancerEvidenceLink)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api(`/jobs/${jobId}/dispute/respond`, { method: 'POST', body: { response, evidenceLink: link } })
      toast.success('Your response was sent to the arbiter.')
      await onChanged()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not send your response.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={ui.stack} onSubmit={(event) => void submit(event)}>
      <h4>{dispute.respondedAt ? 'Update your response' : 'Respond to the dispute'}</h4>
      <label className={ui.field}>
        <span>Your side</span>
        <textarea className={ui.textarea} value={response} onChange={(e) => setResponse(e.target.value)} required minLength={10} maxLength={2000} placeholder="Explain how the delivery meets what was agreed." />
      </label>
      <label className={ui.field}>
        <span>Evidence link (optional)</span>
        <input className={ui.input} type="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://..." />
      </label>
      <div>
        <Button type="submit" loading={saving}>
          {dispute.respondedAt ? 'Update response' : 'Send response'}
        </Button>
      </div>
    </form>
  )
}

/** Both sides of a dispute, plus the outcome once it is settled. */
export function DisputeCard({ jobId, dispute, role, isArbiter, onChanged }: DisputeCardProps) {
  const hasReason = dispute.reason.length > 0
  const settled = dispute.status === 'resolved'

  return (
    <section className={`${ui.card} ${ui.stack}`}>
      <div className={ui.spread}>
        <h3>Dispute</h3>
        <span className={`${ui.badge} ${settled ? ui.badgeOk : ui.badgeDanger}`}>{settled ? 'Settled' : 'Open'}</span>
      </div>

      {settled ? (
        <div className={`${ui.notice} ${ui.noticeOk}`}>
          <CheckCircle2 size={18} aria-hidden />
          <div className={ui.stack} style={{ gap: 6 }}>
            <strong>{dispute.resolution === 'stale' ? 'Settled automatically for the freelancer' : 'Settled by the arbiter'}</strong>
            <div className={ui.row}>
              <span>
                Freelancer <UsdcAmount raw={dispute.freelancerAmount ?? '0'} size={16} />
              </span>
              <span>
                Client <UsdcAmount raw={dispute.clientAmount ?? '0'} size={16} />
              </span>
            </div>
            <span className={ui.muted}>{dispute.resolvedAt ? formatDateTime(dispute.resolvedAt) : ''}</span>
          </div>
        </div>
      ) : null}

      <div className={ui.stack} style={{ gap: 8 }}>
        <span className={ui.label}>Client's reason{dispute.openedAt ? `, opened ${formatDateTime(dispute.openedAt)}` : ''}</span>
        {hasReason ? (
          <p className={s.description}>{dispute.reason}</p>
        ) : (
          <p className={ui.muted}>No written reason was saved for this dispute. It was opened directly on the contract.</p>
        )}
        {dispute.evidenceLink ? (
          <a className={`${ui.link} ${s.link}`} href={dispute.evidenceLink} target="_blank" rel="noopener noreferrer">
            {dispute.evidenceLink}
          </a>
        ) : null}
        {hasReason ? (
          <div className={`${ui.notice} ${dispute.verified === false ? ui.noticeError : ''}`}>
            {dispute.verified === false ? <TriangleAlert size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
            <div>
              {dispute.verified === false
                ? 'The saved reason does not match the fingerprint recorded onchain. Treat it with caution.'
                : dispute.verified === true
                  ? 'The saved reason matches the fingerprint recorded onchain.'
                  : 'Waiting for the dispute to be recorded onchain.'}
              <div className={s.hash}>{dispute.onchainHash ?? dispute.reasonHash}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className={ui.stack} style={{ gap: 8 }}>
        <span className={ui.label}>Freelancer's response{dispute.respondedAt ? `, ${formatDateTime(dispute.respondedAt)}` : ''}</span>
        {dispute.freelancerResponse ? (
          <>
            <p className={s.description}>{dispute.freelancerResponse}</p>
            {dispute.freelancerEvidenceLink ? (
              <a className={`${ui.link} ${s.link}`} href={dispute.freelancerEvidenceLink} target="_blank" rel="noopener noreferrer">
                {dispute.freelancerEvidenceLink}
              </a>
            ) : null}
          </>
        ) : (
          <p className={ui.muted}>{isArbiter || role === 'client' ? 'No response from the freelancer yet.' : 'You have not responded yet.'}</p>
        )}
      </div>

      {role === 'freelancer' && dispute.status === 'open' ? <FreelancerResponseForm jobId={jobId} dispute={dispute} onChanged={onChanged} /> : null}
    </section>
  )
}
