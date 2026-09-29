import { useState, type FormEvent } from 'react'
import { useRuntimeConfig } from '../hooks/useContracts'
import { useWallet } from '../hooks/useWallet'
import { formatToken, plural, shortAddress } from '../lib/format'
import { isOrderId, isValidEmail, listOrders } from '../lib/orders'
import { claimCard, operatorConfigured, type OperatorClaimResult } from '../lib/operator'
import { AddressChip, Notice, Spinner } from '../components/ui'

export function ClaimPage() {
  const { chain, payment } = useRuntimeConfig()
  const wallet = useWallet()
  const orders = listOrders().filter((o) => o.status === 'paid')
  const [orderId, setOrderId] = useState('')
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isClaiming, setIsClaiming] = useState(false)
  const [result, setResult] = useState<OperatorClaimResult | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const ref = orderId.trim()
    if (!isOrderId(ref)) {
      setFormError('Enter the order reference from your payment confirmation: 0x followed by 64 hexadecimal characters.')
      return
    }
    if (!isValidEmail(email)) {
      setFormError('Enter the email address you gave when paying, like name@example.com.')
      return
    }
    if (!wallet.address) {
      setFormError('Connect the wallet that paid before claiming.')
      return
    }
    setFormError(null)
    setClaimError(null)
    setIsClaiming(true)
    try {
      setResult(await claimCard({ chainId: chain.id, contract: payment.address, payer: wallet.address, orderId: ref as `0x${string}` }, email.trim()))
    } catch {
      setClaimError('Unable to reach the operator service. Try again in a moment, or wait for the card email.')
    } finally {
      setIsClaiming(false)
    }
  }

  return (
    <div className="stack">
      <div className="stack-tight">
        <h1>Claim your card</h1>
        <p className="muted">
          The operator sends the card to the email you entered when paying, within 15 minutes of the on-chain receipt.
          Card details are never shown from the order reference alone.
        </p>
      </div>

      <section className="card" aria-labelledby="paid-title">
        <h2 id="paid-title">Paid orders in this browser</h2>
        {orders.length === 0 ? (
          <div className="empty stack-tight">
            <p>
              <strong>No paid orders yet</strong>
            </p>
            <p className="small muted">After a payment confirms, the order and its delivery email appear here.</p>
            <p>
              <a className="btn btn-primary" href="#/">
                Get a spend card
              </a>
            </p>
          </div>
        ) : (
          <ul className="order-list">
            {orders.map((o) => (
              <li key={`${o.payer}-${o.orderId}`} className="order-item">
                <div className="row-between">
                  <span>
                    <strong>Order</strong> <AddressChip address={o.orderId} label="order reference" kind="tx" />
                  </span>
                  <span className="muted">
                    Payer <span className="mono">{shortAddress(o.payer)}</span>
                  </span>
                </div>
                <span>
                  {formatToken(BigInt(o.amountMinor))} IMD for {o.packs} {plural(o.packs, 'pack', 'packs')} · card to <strong>{o.email}</strong>
                </span>
                {operatorConfigured ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setOrderId(o.orderId)
                      setEmail(o.email)
                      setResult(null)
                    }}
                  >
                    Use this order below
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {operatorConfigured ? (
        <form className="card" onSubmit={submit} noValidate aria-labelledby="claim-title">
          <h2 id="claim-title">Retrieve card details</h2>
          <p className="small muted">
            The operator checks the reference, the paying wallet and the email privately before returning anything.
          </p>
          <div className="field">
            <label htmlFor="claim-order">Order reference</label>
            <input
              id="claim-order"
              className="input mono"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x… (64 hexadecimal characters)"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="claim-email">Email used when paying</label>
            <input
              id="claim-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={formError ? 'true' : undefined}
              aria-describedby={formError ? 'claim-error' : undefined}
            />
            {formError ? (
              <span id="claim-error" className="error">
                {formError}
              </span>
            ) : null}
          </div>
          {!wallet.isConnected ? (
            <Notice kind="info">Connect the wallet that paid on the first page before claiming.</Notice>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={isClaiming}>
            {isClaiming ? <Spinner /> : null}
            {isClaiming ? 'Checking with the operator' : 'Retrieve card details'}
          </button>
          {claimError ? <Notice kind="danger">{claimError}</Notice> : null}
          {result ? (
            <Notice kind={result.card ? 'success' : 'info'}>
              {result.status}
              {result.message ? `. ${result.message}` : ''}
              {result.card ? (
                <dl className="facts">
                  {Object.entries(result.card).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="mono">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Notice>
          ) : null}
        </form>
      ) : (
        <section className="card" aria-labelledby="email-title">
          <h2 id="email-title">Delivery by email</h2>
          <p>
            This build has no operator claim service configured, so the card is delivered only by email. Check the inbox
            you entered, including spam folders. If nothing arrives within 15 minutes of the receipt time shown on the
            status page, the operator owes a full IMD refund to the paying wallet.
          </p>
          <p className="small muted">
            When contacting the operator, quote the order reference and paying wallet address. Never share wallet seed
            phrases or private keys; nobody legitimate needs them.
          </p>
          <a className="btn btn-secondary" href="#/status">
            View order status
          </a>
        </section>
      )}
    </div>
  )
}
