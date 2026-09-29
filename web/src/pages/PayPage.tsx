import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import type { Hex } from 'viem'
import { useContractFacts, useQuote, useRuntimeConfig, useWalletTokenState } from '../hooks/useContracts'
import { useWallet } from '../hooks/useWallet'
import { describeError } from '../lib/errors'
import { formatToken, plural, usdForToken } from '../lib/format'
import { generateOrderId, isValidEmail, saveOrder, updateOrder, type OrderRecord } from '../lib/orders'
import { operatorConfigured, submitOrderIntake } from '../lib/operator'
import { AddressChip, Notice, Spinner } from '../components/ui'

const PACK_CHOICES = [1, 2, 3] as const
const DEADLINE_MINUTES = 20

type Step = 'connect' | 'switch' | 'approve' | 'pay' | 'done'

export function PayPage() {
  const config = useRuntimeConfig()
  const wallet = useWallet()
  const publicClient = usePublicClient()
  const { facts, error: factsError } = useContractFacts()
  const [packs, setPacks] = useState<number>(1)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  const { quote } = useQuote(packs)
  const tokenState = useWalletTokenState(wallet.address)
  const { writeContractAsync } = useWriteContract()

  const [approveHash, setApproveHash] = useState<Hex | undefined>()
  const [payHash, setPayHash] = useState<Hex | undefined>()
  const [isApproving, setIsApproving] = useState(false)
  const [approveCooldown, setApproveCooldown] = useState(false)
  const [isPaying, setIsPaying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completed, setCompleted] = useState<OrderRecord | null>(null)
  const [pendingOrder, setPendingOrder] = useState<OrderRecord | null>(null)

  const approveReceipt = useWaitForTransactionReceipt({ hash: approveHash, query: { enabled: Boolean(approveHash) } })
  const payReceipt = useWaitForTransactionReceipt({ hash: payHash, query: { enabled: Boolean(payHash) } })

  // Approval confirmed: refetch allowance and hold the button until fresh state arrives.
  useEffect(() => {
    if (!approveReceipt.isSuccess) return
    setApproveCooldown(true)
    void tokenState.refetch()
    const t = setTimeout(() => setApproveCooldown(false), 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess])

  // A new pack count needs its own approval; drop the previous approval notice.
  useEffect(() => {
    setApproveHash(undefined)
    setActionError(null)
  }, [packs])

  // Payment confirmed or reverted on-chain.
  useEffect(() => {
    if (!pendingOrder || !payHash) return
    if (payReceipt.isSuccess && payReceipt.data?.status === 'success') {
      const paid: OrderRecord = { ...pendingOrder, status: 'paid', txHash: payHash, paidAt: Math.floor(Date.now() / 1000) }
      updateOrder(paid.orderId, paid.payer, { status: 'paid', txHash: payHash, paidAt: paid.paidAt })
      setCompleted(paid)
      setPendingOrder(null)
      void tokenState.refetch()
    } else if (payReceipt.isSuccess && payReceipt.data?.status === 'reverted') {
      updateOrder(pendingOrder.orderId, pendingOrder.payer, { status: 'failed', txHash: payHash })
      setActionError('The payment transaction reverted on-chain. Nothing was charged. Start a new order and try again.')
      setPendingOrder(null)
      setPayHash(undefined)
    } else if (payReceipt.isError) {
      setActionError(describeError(payReceipt.error, 'Unable to confirm the payment. Check the transaction in the explorer.'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payReceipt.isSuccess, payReceipt.isError, payReceipt.data?.status])

  const midUsd = facts?.imdMidUsdE8
  const needsApproval = quote !== undefined && tokenState.allowance !== undefined && tokenState.allowance < quote
  const insufficientBalance = quote !== undefined && tokenState.balance !== undefined && tokenState.balance < quote

  const step: Step = completed
    ? 'done'
    : !wallet.isConnected
      ? 'connect'
      : !wallet.onChain
        ? 'switch'
        : needsApproval || isApproving || approveCooldown || (approveHash && !approveReceipt.isSuccess)
          ? 'approve'
          : 'pay'

  const validateEmail = (): boolean => {
    if (!isValidEmail(email)) {
      setEmailError('Enter the email address that should receive the card, like name@example.com.')
      emailRef.current?.focus()
      return false
    }
    setEmailError(null)
    return true
  }

  const approve = async () => {
    if (quote === undefined) return
    setActionError(null)
    setIsApproving(true)
    try {
      const hash = await writeContractAsync({
        address: config.token.address,
        abi: config.token.abi,
        functionName: 'approve',
        args: [config.payment.address, quote],
        chainId: config.chain.id,
      })
      setApproveHash(hash)
    } catch (e) {
      setActionError(describeError(e, 'Unable to approve IMD. Try again.'))
    } finally {
      setIsApproving(false)
    }
  }

  const pay = async (event: FormEvent) => {
    event.preventDefault()
    if (step !== 'pay' || quote === undefined || !wallet.address || !publicClient) return
    if (!validateEmail()) return
    setActionError(null)
    setIsPaying(true)
    const orderId = generateOrderId()
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60
    const order: OrderRecord = {
      orderId,
      chainId: config.chain.id,
      contract: config.payment.address,
      payer: wallet.address,
      packs,
      amountMinor: quote.toString(),
      email: email.trim(),
      createdAt: Math.floor(Date.now() / 1000),
      deadline,
      status: 'draft',
    }
    try {
      saveOrder(order)
      // Simulate first so a revert reason is shown before the wallet is asked to sign.
      await publicClient.simulateContract({
        address: config.payment.address,
        abi: config.payment.abi,
        functionName: 'pay',
        args: [packs, orderId, BigInt(deadline)],
        account: wallet.address,
      })
      try {
        await submitOrderIntake(order)
      } catch (e) {
        // Intake is best effort; the on-chain receipt and local record remain the source of truth.
        console.warn('operator intake failed', e)
      }
      const hash = await writeContractAsync({
        address: config.payment.address,
        abi: config.payment.abi,
        functionName: 'pay',
        args: [packs, orderId, BigInt(deadline)],
        chainId: config.chain.id,
      })
      updateOrder(orderId, wallet.address, { status: 'submitted', txHash: hash })
      setPendingOrder({ ...order, status: 'submitted', txHash: hash })
      setPayHash(hash)
      setApproveHash(undefined)
    } catch (e) {
      updateOrder(orderId, wallet.address, { status: 'failed' })
      setActionError(describeError(e, 'Unable to send the payment. Try again.'))
    } finally {
      setIsPaying(false)
    }
  }

  const startAnother = () => {
    setCompleted(null)
    setPayHash(undefined)
    setActionError(null)
  }

  const quoteText = quote !== undefined ? `${formatToken(quote)} IMD` : '…'
  const quoteUsd = quote !== undefined ? usdForToken(quote, midUsd) : null
  const busy = isApproving || isPaying || wallet.isSwitching || wallet.isConnecting
  const waitingForPay = Boolean(payHash) && !completed

  const stepItems = useMemo(
    () =>
      [
        { key: 'connect', label: 'Connect' },
        { key: 'approve', label: 'Approve IMD' },
        { key: 'pay', label: 'Pay' },
        { key: 'done', label: 'Card by email' },
      ] as const,
    [],
  )
  const stepIndex = { connect: 0, switch: 0, approve: 1, pay: 2, done: 3 }[step]

  return (
    <div className="stack">
      <div className="stack-tight">
        <h1>Get a spend card</h1>
        <p className="muted">
          Pay IMD on {config.chain.name} for one to three Claude-month packs. The card arrives by email within 15 minutes
          of payment, or the operator refunds the full IMD amount to the paying wallet.
        </p>
      </div>

      <ol className="steps" aria-label="Progress">
        {stepItems.map((s, i) => (
          <li key={s.key} aria-current={i === stepIndex ? 'step' : undefined} className={i < stepIndex ? 'done' : undefined}>
            {i < stepIndex ? '✓ ' : `${i + 1}. `}
            {s.label}
          </li>
        ))}
      </ol>

      {factsError ? (
        <Notice kind="warning">Unable to read the contract over the public network right now. Quotes may be delayed; reload to retry.</Notice>
      ) : null}

      {completed ? (
        <section className="card" aria-labelledby="done-title">
          <h2 id="done-title">Payment received</h2>
          <Notice kind="success">
            {formatToken(BigInt(completed.amountMinor))} IMD paid for {completed.packs} {plural(completed.packs, 'pack', 'packs')}. The card
            will be sent to <strong>{completed.email}</strong> within 15 minutes.
          </Notice>
          <dl className="summary">
            <dt>Order reference</dt>
            <dd>
              <AddressChip address={completed.orderId} label="order reference" kind="tx" />
            </dd>
            <dt>Transaction</dt>
            <dd>{completed.txHash ? <AddressChip address={completed.txHash} label="transaction hash" kind="tx" /> : '—'}</dd>
          </dl>
          <p className="small muted">
            Keep the order reference: it identifies this purchase on the status and claim pages. It is not a secret and
            is never sufficient on its own to receive card details.
          </p>
          <div className="cluster">
            <a className="btn btn-primary" href="#/status">
              Check order status
            </a>
            <button type="button" className="btn btn-secondary" onClick={startAnother}>
              Buy another
            </button>
          </div>
        </section>
      ) : (
        <form className="card" onSubmit={pay} noValidate aria-describedby="order-help">
          <fieldset>
            <legend>Packs</legend>
            <div className="pack-options">
              {PACK_CHOICES.map((n) => {
                const price = facts ? facts.packPrice * BigInt(n) : undefined
                const usd = price !== undefined ? usdForToken(price, midUsd) : null
                return (
                  <label key={n} className="pack-option">
                    <input
                      type="radio"
                      name="packs"
                      value={n}
                      checked={packs === n}
                      onChange={() => setPacks(n)}
                      disabled={busy || waitingForPay}
                    />
                    <span className="pack-title">
                      {n} {plural(n, 'pack', 'packs')}
                    </span>
                    <span className="pack-price num">
                      {price !== undefined ? `${formatToken(price)} IMD` : 'Loading price'}
                      {usd ? ` · ≈ ${usd}` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
            <p id="order-help" className="hint small muted">
              One pack covers one Claude-month. Prices are fixed by the contract and include an 8% buffer; the USD figure
              uses the contract&apos;s quoted rate and is informational.
            </p>
          </fieldset>

          <div className="field">
            <label htmlFor="email">Email for card delivery</label>
            <input
              ref={emailRef}
              id="email"
              className="input"
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(null)
              }}
              aria-invalid={emailError ? 'true' : undefined}
              aria-describedby={emailError ? 'email-error email-hint' : 'email-hint'}
              disabled={waitingForPay}
              required
            />
            {emailError ? (
              <span id="email-error" className="error">
                {emailError}
              </span>
            ) : null}
            <span id="email-hint" className="hint">
              Stays in this browser{operatorConfigured ? ' and with the operator service' : ''}; never written on-chain.
            </span>
          </div>

          <dl className="summary" aria-label="Order summary">
            <dt>You pay</dt>
            <dd className="total">
              {quoteText}
              {quoteUsd ? <span className="muted small"> · ≈ {quoteUsd}</span> : null}
            </dd>
            {wallet.isConnected && wallet.onChain ? (
              <>
                <dt>Your IMD balance</dt>
                <dd>
                  {tokenState.balance !== undefined ? (
                    <>
                      {formatToken(tokenState.balance)} IMD
                      {usdForToken(tokenState.balance, midUsd) ? (
                        <span className="muted small"> · ≈ {usdForToken(tokenState.balance, midUsd)}</span>
                      ) : null}
                    </>
                  ) : (
                    'Loading'
                  )}
                </dd>
                <dt>Approved for payment</dt>
                <dd>{tokenState.allowance !== undefined ? `${formatToken(tokenState.allowance)} IMD` : 'Loading'}</dd>
              </>
            ) : null}
            <dt>Refund if no card</dt>
            <dd>Within 15 minutes, full amount</dd>
          </dl>

          {wallet.isConnected && wallet.onChain && insufficientBalance ? (
            <Notice kind="warning">
              This wallet holds {formatToken(tokenState.balance ?? 0n)} IMD but the order needs {quoteText}. Add IMD to this
              wallet on {config.chain.name} before paying.
            </Notice>
          ) : null}

          {step === 'connect' ? (
            <div className="wallet-menu">
              {wallet.connectors.length === 0 ? (
                <>
                  <button type="button" className="btn btn-primary btn-block" disabled>
                    Connect wallet
                  </button>
                  <Notice kind="warning">No browser wallet detected. Install a wallet extension, then reload this page.</Notice>
                </>
              ) : wallet.connectors.length === 1 ? (
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => wallet.connect(wallet.connectors[0].id)}
                  disabled={wallet.isConnecting}
                >
                  {wallet.isConnecting ? <Spinner /> : null}
                  {wallet.isConnecting ? 'Connecting' : 'Connect wallet'}
                </button>
              ) : (
                wallet.connectors.map((c, i) => (
                  <button
                    key={c.uid}
                    type="button"
                    className={`btn btn-block ${i === 0 ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => wallet.connect(c.id)}
                    disabled={wallet.isConnecting}
                  >
                    {wallet.isConnecting ? <Spinner /> : null}
                    Connect with {c.name}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {step === 'switch' ? (
            <div className="stack-tight">
              <button type="button" className="btn btn-primary btn-block" onClick={wallet.switchToChain} disabled={wallet.isSwitching}>
                {wallet.isSwitching ? <Spinner /> : null}
                {wallet.isSwitching ? `Switching to ${config.chain.name}` : `Switch to ${config.chain.name}`}
              </button>
              <p className="small muted">
                Your wallet is on another network. If it does not know {config.chain.name}, it will offer to add it first.
              </p>
            </div>
          ) : null}

          {step === 'approve' ? (
            <div className="stack-tight">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={approve}
                disabled={isApproving || approveCooldown || Boolean(approveHash) || quote === undefined || insufficientBalance}
              >
                {isApproving || approveHash ? <Spinner /> : null}
                {isApproving
                  ? 'Confirm in wallet'
                  : approveHash && !approveReceipt.isSuccess
                    ? 'Approving'
                    : approveCooldown
                      ? 'Approved'
                      : `Approve ${quoteText}`}
              </button>
              <p className="small muted">
                Step 1 of 2. This lets the payment contract take exactly {quoteText} from your wallet, once. Paying is a
                separate confirmation.
              </p>
            </div>
          ) : null}

          {approveHash && (step === 'approve' || step === 'pay') ? (
            <Notice kind={approveReceipt.isSuccess ? 'success' : 'info'}>
              {approveReceipt.isSuccess ? `Approval of ${quoteText} confirmed. ` : 'Approval submitted, waiting for confirmation. '}
              <AddressChip address={approveHash} label="approval transaction hash" kind="tx" />
            </Notice>
          ) : null}

          {step === 'pay' ? (
            <div className="stack-tight">
              <button type="submit" className="btn btn-primary btn-block" disabled={isPaying || waitingForPay || quote === undefined || insufficientBalance}>
                {isPaying || waitingForPay ? <Spinner /> : null}
                {isPaying ? 'Confirm in wallet' : waitingForPay ? 'Waiting for confirmation' : `Pay ${quoteText}`}
              </button>
              <p className="small muted">
                Step 2 of 2. Sends {quoteText} to the payment contract, which forwards it to the operator and records the
                receipt. Confirm within {DEADLINE_MINUTES} minutes.
              </p>
              {payHash ? (
                <Notice kind="info">
                  Payment submitted, waiting for confirmation. <AddressChip address={payHash} label="payment transaction hash" kind="tx" />
                </Notice>
              ) : null}
            </div>
          ) : null}

          {wallet.error ? <Notice kind="danger">{wallet.error}</Notice> : null}
          {actionError ? <Notice kind="danger">{actionError}</Notice> : null}
          {tokenState.error && wallet.isConnected && wallet.onChain ? (
            <Notice kind="warning">Unable to read your IMD balance right now. Reads retry automatically.</Notice>
          ) : null}
        </form>
      )}

      <details className="disclosure">
        <summary>How this works</summary>
        <div className="stack-tight small">
          <p>
            Your wallet only ever approves and pays IMD. The contract forwards the exact amount to the operator&apos;s
            settlement wallet in the same transaction and stores a receipt for your wallet and order reference.
          </p>
          <p>
            The operator delivers the card to your email within 15 minutes. If it does not, it owes you a full refund
            of the IMD paid, including the buffer. That obligation is off-chain: the contract holds no funds and cannot
            refund by itself.
          </p>
          <p>Each order reference can be paid once per wallet. Starting a new order creates a new reference.</p>
        </div>
      </details>
    </div>
  )
}
