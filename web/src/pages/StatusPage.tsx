import { useEffect, useState, type FormEvent } from 'react'
import { isAddress, type Address, type Hex } from 'viem'
import { useContractFacts, useReceipt, useRuntimeConfig } from '../hooks/useContracts'
import { useWallet } from '../hooks/useWallet'
import { formatCountdown, formatTimestamp, formatToken, plural, shortAddress } from '../lib/format'
import { isOrderId, listOrders, type OrderRecord } from '../lib/orders'
import { fetchOrderStatus, operatorConfigured, type OperatorOrderStatus } from '../lib/operator'
import { AddressChip, Notice, Spinner } from '../components/ui'

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** One order's on-chain receipt, refund countdown and (optional) operator status. */
export function ReceiptCard({ payer, orderId, local }: { payer: Address; orderId: Hex; local?: OrderRecord }) {
  const { chain, payment } = useRuntimeConfig()
  const { facts } = useContractFacts()
  const { receipt, isLoading, error } = useReceipt(payer, orderId, local?.status === 'submitted')
  const now = useNow()
  const [operator, setOperator] = useState<OperatorOrderStatus | null>(null)
  const [operatorError, setOperatorError] = useState<string | null>(null)

  useEffect(() => {
    if (!operatorConfigured || !receipt) return
    let cancelled = false
    fetchOrderStatus({ chainId: chain.id, contract: payment.address, payer, orderId })
      .then((s) => {
        if (!cancelled) setOperator(s)
      })
      .catch(() => {
        if (!cancelled) setOperatorError('Operator status is unavailable right now. The on-chain receipt below is still valid.')
      })
    return () => {
      cancelled = true
    }
  }, [chain.id, payment.address, payer, orderId, receipt])

  const refundDelay = facts ? Number(facts.refundDelay) : 900
  const refundDueAt = receipt ? Number(receipt.paidAt) + refundDelay : null
  const remaining = refundDueAt !== null ? refundDueAt - now : null

  return (
    <li className="order-item">
      <div className="row-between">
        <span>
          <strong>Order</strong> <AddressChip address={orderId} label="order reference" kind="tx" />
        </span>
        <span className="muted">
          Payer <span className="mono">{shortAddress(payer)}</span>
        </span>
      </div>
      {isLoading ? (
        <span className="cluster muted">
          <Spinner /> Reading receipt
        </span>
      ) : error ? (
        <Notice kind="warning">Unable to read the receipt from {chain.name} right now. It retries automatically.</Notice>
      ) : receipt ? (
        <>
          <span className={`badge badge-ok`}>Paid on-chain</span>
          <dl className="facts">
            <div>
              <dt>Amount</dt>
              <dd className="num">
                {formatToken(receipt.amount)} IMD for {receipt.packs} {plural(receipt.packs, 'pack', 'packs')}
              </dd>
            </div>
            <div>
              <dt>Paid at</dt>
              <dd>{formatTimestamp(receipt.paidAt)}</dd>
            </div>
            <div>
              <dt>Card due by</dt>
              <dd>
                {refundDueAt !== null ? formatTimestamp(refundDueAt) : '—'}
                {remaining !== null ? (
                  <span className="num muted"> {remaining > 0 ? `(${formatCountdown(remaining)} left)` : '(deadline passed)'}</span>
                ) : null}
              </dd>
            </div>
            {local?.txHash ? (
              <div>
                <dt>Transaction</dt>
                <dd>
                  <AddressChip address={local.txHash} label="payment transaction hash" kind="tx" />
                </dd>
              </div>
            ) : null}
            {local?.email ? (
              <div>
                <dt>Card email</dt>
                <dd>{local.email}</dd>
              </div>
            ) : null}
          </dl>
          {remaining !== null && remaining <= 0 ? (
            <Notice kind="warning">
              The 15-minute window has passed. If no card arrived, the operator owes a full refund of{' '}
              {formatToken(receipt.amount)} IMD to the paying wallet. The contract cannot enforce it; contact the operator with
              this order reference.
            </Notice>
          ) : null}
          {operator ? (
            <Notice kind={operator.status === 'delivered' ? 'success' : operator.status.startsWith('refund') ? 'warning' : 'info'}>
              Operator status: {operator.status}
              {operator.message ? `. ${operator.message}` : ''}
              {operator.refundTxHash ? (
                <>
                  {' '}
                  Refund <AddressChip address={operator.refundTxHash} label="refund transaction hash" kind="tx" />
                </>
              ) : null}
            </Notice>
          ) : operatorError ? (
            <Notice kind="warning">{operatorError}</Notice>
          ) : null}
        </>
      ) : (
        <>
          <span className="badge">Not paid</span>
          {local?.status === 'submitted' ? (
            <Notice kind="info">
              Payment submitted, waiting for confirmation on {chain.name}.{' '}
              {local.txHash ? <AddressChip address={local.txHash} label="payment transaction hash" kind="tx" /> : null}
            </Notice>
          ) : local?.status === 'failed' ? (
            <Notice kind="warning">The payment for this reference failed or was rejected. Nothing was charged. Start a new order to try again.</Notice>
          ) : (
            <p className="small muted">No receipt exists on {chain.name} for this wallet and order reference.</p>
          )}
        </>
      )}
    </li>
  )
}

export function StatusPage() {
  const wallet = useWallet()
  const [orders, setOrders] = useState<OrderRecord[]>(() => listOrders())
  const [lookupPayer, setLookupPayer] = useState('')
  const [lookupOrder, setLookupOrder] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<{ payer: Address; orderId: Hex } | null>(null)

  useEffect(() => {
    const refresh = () => setOrders(listOrders())
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const submitLookup = (event: FormEvent) => {
    event.preventDefault()
    const payer = lookupPayer.trim() || wallet.address || ''
    if (!isAddress(payer)) {
      setLookupError('Enter the paying wallet address as 0x followed by 40 hexadecimal characters.')
      return
    }
    if (!isOrderId(lookupOrder.trim())) {
      setLookupError('Enter the order reference as 0x followed by 64 hexadecimal characters.')
      return
    }
    setLookupError(null)
    setLookup({ payer, orderId: lookupOrder.trim() as Hex })
  }

  const own = wallet.address ? orders.filter((o) => o.payer.toLowerCase() === wallet.address!.toLowerCase()) : orders

  return (
    <div className="stack">
      <div className="stack-tight">
        <h1>Order status</h1>
        <p className="muted">
          Receipts are read live from the payment contract. Card delivery and refunds come from the operator by email
          {operatorConfigured ? ' and from the operator service below' : ''}.
        </p>
      </div>

      <section className="card" aria-labelledby="orders-title">
        <h2 id="orders-title">Orders from this browser</h2>
        {own.length === 0 ? (
          <div className="empty stack-tight">
            <p>
              <strong>No orders yet</strong>
            </p>
            <p className="small muted">Orders you pay from this browser appear here with their live receipt and refund deadline.</p>
            <p>
              <a className="btn btn-primary" href="#/">
                Get a spend card
              </a>
            </p>
          </div>
        ) : (
          <ul className="order-list">
            {own.map((o) => (
              <ReceiptCard key={`${o.payer}-${o.orderId}`} payer={o.payer} orderId={o.orderId} local={o} />
            ))}
          </ul>
        )}
      </section>

      <form className="card" onSubmit={submitLookup} noValidate aria-labelledby="lookup-title">
        <h2 id="lookup-title">Look up any receipt</h2>
        <div className="field">
          <label htmlFor="lookup-payer">Paying wallet address</label>
          <input
            id="lookup-payer"
            className="input mono"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={wallet.address ? `${wallet.address} (connected wallet)` : '0x…'}
            value={lookupPayer}
            onChange={(e) => setLookupPayer(e.target.value)}
            aria-describedby="lookup-payer-hint"
          />
          <span id="lookup-payer-hint" className="hint">
            {wallet.address ? 'Leave empty to use the connected wallet.' : 'The wallet that sent the payment.'}
          </span>
        </div>
        <div className="field">
          <label htmlFor="lookup-order">Order reference</label>
          <input
            id="lookup-order"
            className="input mono"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x… (64 hexadecimal characters)"
            value={lookupOrder}
            onChange={(e) => setLookupOrder(e.target.value)}
            aria-invalid={lookupError ? 'true' : undefined}
            aria-describedby={lookupError ? 'lookup-error' : undefined}
          />
          {lookupError ? (
            <span id="lookup-error" className="error">
              {lookupError}
            </span>
          ) : null}
        </div>
        <button type="submit" className="btn btn-secondary">
          Look up receipt
        </button>
        {lookup ? (
          <ul className="order-list" aria-label="Lookup result">
            <ReceiptCard payer={lookup.payer} orderId={lookup.orderId} />
          </ul>
        ) : null}
      </form>
    </div>
  )
}
