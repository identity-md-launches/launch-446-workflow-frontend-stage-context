import { describe, expect, it } from 'vitest'
import { formatCountdown, formatToken, formatUsdE8, shortAddress, usdForToken } from '../src/lib/format'

describe('format', () => {
  it('formats 18-decimal amounts with grouping and trimmed fractions', () => {
    expect(formatToken(2160n * 10n ** 18n)).toBe('2,160')
    expect(formatToken(6480n * 10n ** 18n)).toBe('6,480')
    expect(formatToken(756n * 10n ** 16n)).toBe('7.56')
    expect(formatToken(1n)).toBe('0')
    expect(formatToken(10n ** 27n)).toBe('1,000,000,000')
  })

  it('formats USD scaled by 1e8', () => {
    expect(formatUsdE8(2000000000n)).toBe('$20.00')
    expect(formatUsdE8(1000000n)).toBe('$0.01')
    expect(formatUsdE8(6000000000n)).toBe('$60.00')
    expect(formatUsdE8(123456789012n)).toBe('$1,234.57')
  })

  it('derives USD context only from an on-chain midpoint', () => {
    expect(usdForToken(2160n * 10n ** 18n, 1000000n)).toBe('$21.60')
    expect(usdForToken(2160n * 10n ** 18n, undefined)).toBeNull()
  })

  it('shortens checksummed addresses', () => {
    // EIP-55 checksum of the payment contract address, as viem's getAddress produces it.
    expect(shortAddress('0x7ffdd2022de16ff12487904e60e9e8f0c4892721')).toBe('0x7FfD…2721')
  })

  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5)).toBe('0:00')
    expect(formatCountdown(899)).toBe('14:59')
    expect(formatCountdown(3661)).toBe('1:01:01')
  })
})
