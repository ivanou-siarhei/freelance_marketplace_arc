import type { ReactNode } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ShieldCheck, Wallet } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { ARC_CHAIN_ID } from '@/lib/escrow'
import { requireChain } from '@/onchain-facts'
import { Button } from './Button'
import s from '@/styles/ui.module.scss'

/** Shows children only for a connected wallet on Arc Testnet with a signed-in session. */
export function ConnectGate({ children, reason }: { children: ReactNode; reason: string }) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const { signedIn, signingIn, signIn } = useSession()

  if (!isConnected) {
    return (
      <div className={`${s.card} ${s.empty}`}>
        <Wallet size={28} aria-hidden />
        <h3>Connect your wallet</h3>
        <p>{reason}</p>
        <ConnectKitButton.Custom>
          {({ show }) => (
            <Button onClick={show}>
              Connect wallet
            </Button>
          )}
        </ConnectKitButton.Custom>
      </div>
    )
  }

  if (chainId !== ARC_CHAIN_ID) {
    return (
      <div className={`${s.card} ${s.empty}`}>
        <h3>Switch network</h3>
        <p>ArcWork runs on {requireChain(ARC_CHAIN_ID).name}.</p>
        <Button loading={isPending} onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}>
          Switch to {requireChain(ARC_CHAIN_ID).name}
        </Button>
      </div>
    )
  }

  if (!signedIn) {
    return (
      <div className={`${s.card} ${s.empty}`}>
        <ShieldCheck size={28} aria-hidden />
        <h3>Sign in to continue</h3>
        <p>Sign a message to prove this wallet is yours. It is free and does not move any funds.</p>
        <Button loading={signingIn} onClick={() => void signIn()}>
          Sign in with wallet
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
