import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { api, type AppConfig } from '@/lib/api'

export function useAppConfig() {
  const query = useQuery({
    queryKey: ['config'],
    queryFn: () => api<AppConfig>('/config'),
    staleTime: 60_000,
  })
  return {
    ...query,
    escrowAddress: (query.data?.escrowAddress ?? null) as Address | null,
    params: query.data?.params ?? null,
  }
}
