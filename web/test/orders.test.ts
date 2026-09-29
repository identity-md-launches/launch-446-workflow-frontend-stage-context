import { describe, expect, it } from 'vitest'
import { generateOrderId, isOrderId, isValidEmail, listOrders, saveOrder, updateOrder, type OrderRecord, type StorageLike } from '../src/lib/orders'

function memoryStore(): StorageLike {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

const base: OrderRecord = {
  orderId: '0x' + '11'.repeat(32) as `0x${string}`,
  chainId: 11155111,
  contract: '0x7ffdd2022de16ff12487904e60e9e8f0c4892721',
  payer: '0x1111111111111111111111111111111111111111',
  packs: 2,
  amountMinor: '4320000000000000000000',
  email: 'name@example.com',
  createdAt: 1,
  deadline: 1201,
  status: 'draft',
}

describe('orders', () => {
  it('generates random nonzero 32-byte references and never returns zero', () => {
    const id = generateOrderId()
    expect(isOrderId(id)).toBe(true)
    let calls = 0
    const forcedZeroThenOne = generateOrderId((b) => {
      calls++
      if (calls === 1) return b.fill(0)
      b[31] = 1
      return b
    })
    expect(forcedZeroThenOne).toBe('0x' + '00'.repeat(31) + '01')
  })

  it('rejects malformed or zero order ids', () => {
    expect(isOrderId('0x' + '0'.repeat(64))).toBe(false)
    expect(isOrderId('0x1234')).toBe(false)
    expect(isOrderId('0x' + 'ab'.repeat(32))).toBe(true)
  })

  it('stores, replaces and updates orders per (payer, orderId)', () => {
    const store = memoryStore()
    expect(listOrders(store)).toEqual([])
    saveOrder(base, store)
    saveOrder({ ...base, packs: 3 }, store)
    expect(listOrders(store)).toHaveLength(1)
    expect(listOrders(store)[0].packs).toBe(3)
    updateOrder(base.orderId, base.payer, { status: 'paid', txHash: '0xabc' }, store)
    expect(listOrders(store)[0].status).toBe('paid')
    expect(listOrders(store)[0].txHash).toBe('0xabc')
  })

  it('validates emails without being clever', () => {
    expect(isValidEmail('name@example.com')).toBe(true)
    expect(isValidEmail(' name@example.com ')).toBe(true)
    expect(isValidEmail('name@example')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})
