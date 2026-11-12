import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, type HealthResponse } from '@/lib/api'
import ui from '@/styles/ui.module.scss'

/** Shown while the chain indexer is catching up, so stale job status is never presented as current. */
export function SyncBanner() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthResponse>('/health'),
    refetchInterval: 10_000,
    retry: false,
  })
  const behind = Number(health.data?.indexer.blocksBehind ?? 0)
  if (health.isError) {
    return (
      <div className={ui.page} style={{ paddingBottom: 0, paddingTop: 12 }}>
        <div className={`${ui.notice} ${ui.noticeError}`}>The ArcWork server is not reachable, so jobs cannot load right now.</div>
      </div>
    )
  }
  if (!health.data?.indexer.enabled || behind < 300) return null
  return (
    <div className={ui.page} style={{ paddingBottom: 0, paddingTop: 12 }}>
      <div className={`${ui.notice} ${ui.noticeWarn}`}>
        <RefreshCw size={18} aria-hidden />
        <span>
          Catching up with the chain ({behind.toLocaleString()} blocks behind). Payment status below may be out of date until this finishes.
        </span>
      </div>
    </div>
  )
}
