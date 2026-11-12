import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react'
import type { Delivery } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import ui from '@/styles/ui.module.scss'
import s from '@/pages/JobDetail.module.scss'

/** The delivered work and whether the stored record matches the hash committed onchain. */
export function DeliveryCard({ delivery }: { delivery: Delivery }) {
  return (
    <section className={`${ui.card} ${ui.stack}`}>
      <div className={ui.spread}>
        <h3>Delivered work</h3>
        {delivery.verified === true ? (
          <span className={`${ui.badge} ${ui.badgeOk}`}>Matches onchain record</span>
        ) : delivery.verified === false ? (
          <span className={`${ui.badge} ${ui.badgeDanger}`}>Does not match onchain record</span>
        ) : (
          <span className={ui.badge}>Not submitted onchain yet</span>
        )}
      </div>
      <p className={s.description}>{delivery.note}</p>
      <a className={`${ui.link} ${s.link}`} href={delivery.link} target="_blank" rel="noopener noreferrer">
        {delivery.link}
      </a>
      <div className={`${ui.notice} ${delivery.verified === false ? ui.noticeError : ''}`}>
        {delivery.verified === true ? <CheckCircle2 size={18} aria-hidden /> : delivery.verified === false ? <TriangleAlert size={18} aria-hidden /> : <Clock size={18} aria-hidden />}
        <div>
          <div>
            The freelancer committed this fingerprint of the note and link when submitting
            {delivery.submittedAt ? ` on ${formatDateTime(delivery.submittedAt)}` : ''}:
          </div>
          <div className={s.hash}>{delivery.onchainHash ?? delivery.deliveryHash}</div>
          <div className={ui.muted} style={{ marginTop: 6 }}>
            A fingerprint proves the text above was not edited afterwards. It cannot prove that the link still shows the same content, so prefer immutable or content-addressed links.
          </div>
        </div>
      </div>
    </section>
  )
}
