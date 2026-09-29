import { bytesToHex, type Address, type Hex } from 'viem'

export type OrderStatus = 'draft' | 'submitted' | 'paid' | 'failed'

/**
 * A locally recorded order. The order reference is random and opaque: it is never an
 * email hash or a claim credential. Email stays in this browser (and with the operator
 * service when one is configured); it is never written on-chain.
 */
export interface OrderRecord {
  orderId: Hex
  chainId: number
  contract: Address
  payer: Address
  packs: number
  amountMinor: string
  email: string
  createdAt: number
  deadline: number
  status: OrderStatus
  txHash?: Hex
  paidAt?: number
}

export const ORDERS_KEY = 'imd-spend-card:orders:v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** A random, nonzero 32-byte order reference. */
type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

export function generateOrderId(random: RandomFill = (b) => crypto.getRandomValues(b)): Hex {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = random(new Uint8Array(new ArrayBuffer(32)))
    if (bytes.some((b) => b !== 0)) return bytesToHex(bytes)
  }
  throw new Error('Unable to generate a random order reference')
}

export function isOrderId(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/.test(value)
}

export function listOrders(store: StorageLike | null = storage()): OrderRecord[] {
  if (!store) return []
  try {
    const parsed = JSON.parse(store.getItem(ORDERS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as OrderRecord[]) : []
  } catch {
    return []
  }
}

export function saveOrder(order: OrderRecord, store: StorageLike | null = storage()): OrderRecord[] {
  const orders = listOrders(store).filter((o) => !(o.orderId === order.orderId && o.payer === order.payer))
  orders.unshift(order)
  const trimmed = orders.slice(0, 50)
  store?.setItem(ORDERS_KEY, JSON.stringify(trimmed))
  return trimmed
}

export function updateOrder(
  orderId: Hex,
  payer: Address,
  patch: Partial<OrderRecord>,
  store: StorageLike | null = storage(),
): OrderRecord[] {
  const orders = listOrders(store).map((o) => (o.orderId === orderId && o.payer === payer ? { ...o, ...patch } : o))
  store?.setItem(ORDERS_KEY, JSON.stringify(orders))
  return orders
}

export function isValidEmail(value: string): boolean {
  const v = value.trim()
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}
