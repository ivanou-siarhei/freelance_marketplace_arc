import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { createSiweMessage } from 'viem/siwe'
import { toast } from 'sonner'
import { api, setApiToken } from '@/lib/api'
import { parseOnchainError } from '@/lib/format'
import { requireChain } from '@/onchain-facts'

const STORAGE_KEY = 'arcwork.session'
const CHAIN_ID = 5042002

interface StoredSession {
  token: string
  address: string
  expiresAt: string
}

interface SessionValue {
  /** Lowercased address of the signed-in wallet, or null when there is no valid session. */
  address: string | null
  signedIn: boolean
  signingIn: boolean
  signIn: () => Promise<boolean>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    return new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address: wallet } = useAccount()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const [session, setSession] = useState<StoredSession | null>(() => {
    const stored = readStored()
    setApiToken(stored?.token ?? null)
    return stored
  })
  const [signingIn, setSigningIn] = useState(false)

  // A session belongs to one wallet. The API token is only attached while that wallet is connected,
  // so switching accounts never lets requests act as the previous account.
  const sessionValid = Boolean(session && wallet && wallet.toLowerCase() === session.address)
  useEffect(() => {
    setApiToken(sessionValid && session ? session.token : null)
  }, [sessionValid, session])

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!wallet) return false
    setSigningIn(true)
    try {
      const { nonce } = await api<{ nonce: string }>('/auth/nonce', { method: 'POST', body: {} })
      const message = createSiweMessage({
        address: wallet,
        chainId: CHAIN_ID,
        // The server checks this host against its own allowlist.
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: '1',
        statement: `Sign in to ArcWork on ${requireChain(CHAIN_ID).name}. This does not cost gas or move funds.`,
        issuedAt: new Date(),
      })
      const signature = await signMessageAsync({ message })
      const result = await api<{ token: string; address: string; expiresAt: string }>('/auth/verify', {
        method: 'POST',
        body: { message, signature },
      })
      const stored: StoredSession = { token: result.token, address: result.address.toLowerCase(), expiresAt: result.expiresAt }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      setApiToken(stored.token)
      setSession(stored)
      return true
    } catch (error) {
      const text = parseOnchainError(error)
      if (text !== 'Cancelled in your wallet.') toast.error(text)
      return false
    } finally {
      setSigningIn(false)
    }
  }, [wallet, signMessageAsync])

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} })
    } catch {
      // The local session is cleared either way.
    }
    setApiToken(null)
    setSession(null)
    localStorage.removeItem(STORAGE_KEY)
    disconnect()
  }, [disconnect])

  const value = useMemo<SessionValue>(
    () => ({
      address: sessionValid && session ? session.address : null,
      signedIn: sessionValid,
      signingIn,
      signIn,
      signOut,
    }),
    [session, sessionValid, signingIn, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}
