import type { JobStatus } from '@/lib/api'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/format'
import s from '@/styles/ui.module.scss'

const TONE_CLASS = {
  ok: s.badgeOk,
  warn: s.badgeWarn,
  info: s.badgeInfo,
  danger: s.badgeDanger,
  neutral: '',
} as const

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`${s.badge} ${TONE_CLASS[STATUS_TONE[status]]}`}>{STATUS_LABEL[status]}</span>
}
