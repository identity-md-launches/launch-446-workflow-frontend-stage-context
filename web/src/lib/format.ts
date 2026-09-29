import { formatUnits, getAddress, isAddress, type Address } from 'viem'

export const IMD_DECIMALS = 18
export const USD_E8 = 100_000_000n

/** Format 18-decimal minor units as a grouped decimal string, trimming trailing zeros. */
export function formatToken(minor: bigint, decimals = IMD_DECIMALS, maxFraction = 4): string {
  const raw = formatUnits(minor, decimals)
  const [whole, fraction = ''] = raw.split('.')
  const negative = whole.startsWith('-')
  const digits = negative ? whole.slice(1) : whole
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = fraction.slice(0, maxFraction).replace(/0+$/, '')
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

/** Format a USD amount scaled by 1e8 as "$12.34" (always two decimals, grouped). */
export function formatUsdE8(value: bigint): string {
  const cents = (value + 500_000n) / 1_000_000n
  const dollars = cents / 100n
  const rest = cents % 100n
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${rest.toString().padStart(2, '0')}`
}

/**
 * USD context for an IMD amount at the contract's quoted midpoint (USD per IMD, scaled by 1e8).
 * Returns null when the midpoint is unknown, so callers can say USD context is unavailable.
 */
export function usdForToken(minor: bigint, midUsdE8: bigint | undefined): string | null {
  if (midUsdE8 === undefined) return null
  const usdE8 = (minor * midUsdE8) / 10n ** BigInt(IMD_DECIMALS)
  return formatUsdE8(usdE8)
}

export function shortAddress(address: string): string {
  const checksummed = isAddress(address) ? getAddress(address) : address
  return `${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`
}

export function checksum(address: string): Address {
  return getAddress(address)
}

export function shortHex(hex: string, head = 10, tail = 6): string {
  if (hex.length <= head + tail + 1) return hex
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`
}

export function formatTimestamp(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** "mm:ss" or "h:mm:ss" for a positive number of seconds; "0:00" at or below zero. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}
