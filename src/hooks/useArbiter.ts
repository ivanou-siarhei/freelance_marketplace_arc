import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useSession } from './useSession'

/** Whether the signed-in wallet is the contract's current arbiter. The server reads it from the chain. */
export function useIsArbiter(): boolean {
  const { address, signedIn } = useSession()
  const query = useQuery({
    queryKey: ['arbiter', address],
    queryFn: () => api<{ arbiter: string | null; isArbiter: boolean }>('/arbiter'),
    enabled: signedIn,
    staleTime: 30_000,
  })
  return Boolean(signedIn && query.data?.isArbiter)
}
