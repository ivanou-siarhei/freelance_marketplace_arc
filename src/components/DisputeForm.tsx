import { useState, type FormEvent } from 'react'
import { Scale } from 'lucide-react'
import type { Escrow } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { useAppConfig } from '@/hooks/useAppConfig'
import type { useEscrowActions } from '@/hooks/useEscrowActions'
import ui from '@/styles/ui.module.scss'
import { Button } from './Button'

interface DisputeFormProps {
  jobId: string
  escrow: Escrow
  actions: ReturnType<typeof useEscrowActions>
}

/** The client's way out of a delivery they disagree with. Only available while the review window is open. */
export function DisputeForm({ jobId, escrow, actions }: DisputeFormProps) {
  const { params } = useAppConfig()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [link, setLink] = useState('')
  const working = actions.busy === 'Opening dispute'

  async function submit(event: FormEvent) {
    event.preventDefault()
    const ok = await actions.dispute(jobId, escrow, reason.trim(), link.trim())
    if (ok) setOpen(false)
  }

  if (!open) {
    return (
      <Button variant="danger" disabled={actions.busy !== null} onClick={() => setOpen(true)}>
        <Scale size={16} aria-hidden />
        Dispute this work
      </Button>
    )
  }

  return (
    <form className={ui.stack} onSubmit={(event) => void submit(event)}>
      <h3>Open a dispute</h3>
      <div className={`${ui.notice} ${ui.noticeWarn}`}>
        <span>
          Funds stay frozen until the arbiter decides how to split them.
          {params
            ? ` If the arbiter does not act within ${formatDuration(params.arbiterTimeout)}, anyone can settle it and the whole amount goes to the freelancer.`
            : ''}
        </span>
      </div>
      <label className={ui.field}>
        <span>What is wrong with the work?</span>
        <textarea className={ui.textarea} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={20} maxLength={2000} placeholder="Explain what was promised and what was delivered." />
      </label>
      <label className={ui.field}>
        <span>Evidence link (optional)</span>
        <input className={ui.input} type="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://..." />
      </label>
      <div className={ui.row}>
        <Button type="submit" variant="danger" loading={working} disabled={actions.busy !== null && !working}>
          Open dispute
        </Button>
        <Button variant="ghost" disabled={actions.busy !== null} onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
      <small className={ui.muted}>Your wallet signs one transaction that records a fingerprint of this reason, so it cannot be edited later.</small>
    </form>
  )
}
