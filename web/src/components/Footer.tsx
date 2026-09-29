import { useBlockNumber } from 'wagmi'
import { useContractFacts, useRuntimeConfig } from '../hooks/useContracts'
import { formatToken, formatUsdE8 } from '../lib/format'
import { AddressChip } from './ui'

/** Deployment facts, live network observability and explorer links for every configured contract. */
export function Footer() {
  const { manifest, chain, rpcUrls, payment, token } = useRuntimeConfig()
  const block = useBlockNumber({ watch: true, query: { refetchInterval: 12_000 } })
  const { facts, error } = useContractFacts()
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <section aria-labelledby="footer-contracts">
          <h2 id="footer-contracts">Contracts on {chain.name}</h2>
          <dl>
            <dt>Payment</dt>
            <dd>
              <AddressChip address={payment.address} label="payment contract address" />
            </dd>
            <dt>IMD token</dt>
            <dd>
              <AddressChip address={token.address} label="IMD token address" />
            </dd>
            {facts ? (
              <>
                <dt>Settlement</dt>
                <dd>
                  <AddressChip address={facts.settlementRecipient} label="settlement recipient address" />
                </dd>
              </>
            ) : null}
            <dt>Source commit</dt>
            <dd className="mono">{manifest.sourceCommit.slice(0, 12)}</dd>
            <dt>Launch</dt>
            <dd className="mono">{manifest.launchId}</dd>
          </dl>
        </section>
        <section aria-labelledby="footer-network">
          <h2 id="footer-network">Network</h2>
          <dl>
            <dt>Chain</dt>
            <dd>
              {chain.name} (id <span className="num">{chain.id}</span>)
            </dd>
            <dt>Latest block</dt>
            <dd className="num" aria-live="polite">
              {block.data !== undefined ? block.data.toString() : block.error ? 'unavailable' : 'loading'}
            </dd>
            <dt>Reads via</dt>
            <dd>{rpcUrls.length ? rpcUrls.map((u) => new URL(u).host).join(', ') : 'wallet provider'}</dd>
            {facts ? (
              <>
                <dt>Quote inputs</dt>
                <dd>
                  {formatUsdE8(facts.claudeProUsdE8)} per pack at {formatUsdE8(facts.imdMidUsdE8)} per IMD, plus 8% buffer, 0% fee
                </dd>
                <dt>Pack price</dt>
                <dd className="num">{formatToken(facts.packPrice)} IMD</dd>
              </>
            ) : error ? (
              <>
                <dt>Contract facts</dt>
                <dd>unavailable until the network responds</dd>
              </>
            ) : null}
          </dl>
        </section>
        <p className="small muted" style={{ gridColumn: '1 / -1' }}>
          {chain.name} is a test network. IMD and ETH here carry no real value. Card delivery and the 15-minute refund are
          obligations of the operator, not enforced by the contract.
        </p>
      </div>
    </footer>
  )
}
