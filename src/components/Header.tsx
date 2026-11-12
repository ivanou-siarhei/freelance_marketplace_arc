import { NavLink, Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Briefcase } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import type { Address } from 'viem'
import { useSession } from '@/hooks/useSession'
import { useUsdcBalance } from '@/hooks/useBalances'
import { useIsArbiter } from '@/hooks/useArbiter'
import { formatUsdcAmount, shortAddress } from '@/lib/format'
import { Button } from './Button'
import s from './Header.module.scss'

const NAV = [
  { to: '/', label: 'Browse jobs', end: true },
  { to: '/post', label: 'Post a job', end: false },
  { to: '/dashboard', label: 'Dashboard', end: false },
  { to: '/profile', label: 'Profile', end: false },
]

function WalletBalance({ owner }: { owner: Address }) {
  const { data, isLoading } = useUsdcBalance(owner)
  if (isLoading || data === undefined) return null
  return (
    <>
      <span className={s.balance} title="Your USDC balance on Arc Testnet">
        <TokenUSDC variant="branded" size={16} />
        {formatUsdcAmount(data)}
      </span>
      {data === 0n ? (
        <a className={s.faucet} href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
          Get test USDC
        </a>
      ) : null}
    </>
  )
}

export function Header() {
  const { address, isConnected } = useAccount()
  const { signedIn, signingIn, signIn } = useSession()
  const isArbiter = useIsArbiter()
  const nav = isArbiter ? [...NAV, { to: '/arbiter', label: 'Arbiter', end: false }] : NAV

  return (
    <header className={s.header}>
      <div className={s.inner}>
        <Link to="/" className={s.brand}>
          <span className={s.mark}>
            <Briefcase size={17} aria-hidden />
          </span>
          ArcWork
        </Link>
        <nav className={s.nav} aria-label="Main">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${s.link} ${isActive ? s.active : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={s.wallet}>
          {isConnected && address ? <WalletBalance owner={address} /> : null}
          {isConnected && !signedIn ? (
            <Button small loading={signingIn} onClick={() => void signIn()}>
              Sign in
            </Button>
          ) : null}
          <ConnectKitButton.Custom>
            {({ show, isConnected: connected, address: shown }) => (
              <Button small variant={connected ? 'secondary' : 'primary'} onClick={show}>
                {connected && shown ? shortAddress(shown) : 'Connect wallet'}
              </Button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </header>
  )
}
