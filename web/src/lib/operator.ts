// Optional operator service integration. The operator backend (order intake, card delivery,
// refunds, claims) is a separate deliverable; this module defines the small public contract
// the frontend expects when VITE_OPERATOR_API_URL is set. Every call is best effort and never
// blocks the on-chain payment flow.
import { OPERATOR_API_URL } from '../config'
import type { OrderRecord } from './orders'

export interface OperatorOrderStatus {
  /** e.g. "paid", "processing", "delivered", "refund-due", "refunded" */
  status: string
  message?: string
  refundTxHash?: string
}

export interface OperatorClaimResult {
  status: string
  message?: string
  card?: Record<string, string>
}

export const operatorConfigured = OPERATOR_API_URL.length > 0

function orderPath(order: Pick<OrderRecord, 'chainId' | 'contract' | 'payer' | 'orderId'>): string {
  return `${OPERATOR_API_URL}/orders/${order.chainId}/${order.contract}/${order.payer}/${order.orderId}`
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Operator service responded with HTTP ${response.status}`)
  return (await response.json()) as T
}

/** Register the order (email + reference) before payment so the operator can match the event. */
export async function submitOrderIntake(order: OrderRecord): Promise<void> {
  if (!operatorConfigured) return
  const body = {
    chainId: order.chainId,
    contract: order.contract,
    payer: order.payer,
    orderId: order.orderId,
    packs: order.packs,
    amount: order.amountMinor,
    email: order.email,
  }
  await parse<unknown>(
    await fetch(`${OPERATOR_API_URL}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export async function fetchOrderStatus(order: Pick<OrderRecord, 'chainId' | 'contract' | 'payer' | 'orderId'>): Promise<OperatorOrderStatus> {
  return parse<OperatorOrderStatus>(await fetch(orderPath(order)))
}

/** Claim card details; the operator verifies the email privately before disclosing anything. */
export async function claimCard(
  order: Pick<OrderRecord, 'chainId' | 'contract' | 'payer' | 'orderId'>,
  email: string,
): Promise<OperatorClaimResult> {
  return parse<OperatorClaimResult>(
    await fetch(`${orderPath(order)}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  )
}
