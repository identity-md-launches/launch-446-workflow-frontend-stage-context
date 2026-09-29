import { ROUTES, type Route } from '../hooks/useHashRoute'
import { useRuntimeConfig } from '../hooks/useContracts'
import { useWallet } from '../hooks/useWallet'
import { shortAddress } from '../lib/format'
import { Spinner } from './ui'

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="7" width="28" height="18" rx="4" fill="var(--color-accent-solid)" />
      <rect x="2" y="11" width="28" height="4" fill="var(--color-accent-text)" />
      <rect x="6" y="18" width="9" height="3" rx="1.5" fill="var(--color-on-accent)" />
    </svg>
  )
}

export function NetworkBadge() {
  const { chain, network } = useRuntimeConfig()
  return (
    <span className="badge badge-network" title={`All actions happen on ${chain.name} (chain id ${chain.id})`}>
      {chain.name}
      {network?.testnet ? ' testnet' : ''}
    </span>
  )
}

export function Header({ route }: { route: Route }) {
  const wallet = useWallet()
  const { chain } = useRuntimeConfig()
  return (
    <header className="site-header">
      <div className="container">
        <a className="brand" href="#/" aria-label="IdentityMD, get a spend card">
          <Logo />
          <span>IdentityMD</span>
        </a>
        <nav className="site-nav" aria-label="Site">
          {ROUTES.map((r) => (
            <a key={r.route} href={r.hash} aria-current={r.route === route ? 'page' : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <div className="header-tools">
          <NetworkBadge />
          {wallet.isConnected && wallet.address ? (
            <>
              <span className={`badge ${wallet.onChain ? 'badge-ok' : 'badge-danger'}`} title={wallet.address}>
                {wallet.onChain ? '' : 'Wrong network · '}
                <span className="mono">{shortAddress(wallet.address)}</span>
              </span>
              {!wallet.onChain ? (
                <button type="button" className="btn btn-secondary btn-small" onClick={wallet.switchToChain} disabled={wallet.isSwitching}>
                  {wallet.isSwitching ? <Spinner /> : null}
                  Switch to {chain.name}
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-small" onClick={wallet.disconnect}>
                Disconnect
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
