import { useState, type FormEvent } from 'react'
import type { Escrow } from '@/lib/api'
import ui from '@/styles/ui.module.scss'
import { Button } from './Button'

interface DeliveryFormProps {
  busy: boolean
  disabled?: boolean
  onSubmit: (note: string, link: string) => void
  escrow: Escrow
}

export function DeliveryForm({ busy, disabled, onSubmit }: DeliveryFormProps) {
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit(note.trim(), link.trim())
  }

  return (
    <form className={ui.stack} onSubmit={submit}>
      <label className={ui.field}>
        <span>Delivery note</span>
        <textarea className={ui.textarea} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you are delivering and anything the client should check." required minLength={5} maxLength={3000} />
      </label>
      <label className={ui.field}>
        <span>Link to the work</span>
        <input className={ui.input} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." required maxLength={500} />
        <small>Use a link that will not change, like a tagged release or an IPFS address.</small>
      </label>
      <Button type="submit" loading={busy} disabled={disabled} block>
        Submit work
      </Button>
      <small className={ui.muted}>
        Your wallet will sign one transaction that records a fingerprint of this note and link. The client then reviews it.
      </small>
    </form>
  )
}
