import { createContext, useContext } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import type { Address, Hex } from 'viem'
import { POLL_INTERVAL_MS, type RuntimeConfig } from '../config'

export const ConfigContext = createContext<RuntimeConfig | null>(null)

export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(ConfigContext)
  if (!config) throw new Error('ConfigContext is missing')
  return config
}

export interface ContractFacts {
  packPrice: bigint
  minPacks: number
  maxPacks: number
  refundDelay: bigint
  feeBps: bigint
  claudeProUsdE8: bigint
  imdMidUsdE8: bigint
  floatTargetUsdE8: bigint
  settlementRecipient: Address
  tokenAddress: Address
  tokenSymbol: string
  tokenDecimals: number
}

/** Immutable contract facts, read once through the public RPC (no wallet needed). */
export function useContractFacts() {
  const { payment, token } = useRuntimeConfig()
  const paymentCall = (functionName: string) => ({ address: payment.address, abi: payment.abi, functionName })
  const tokenCall = (functionName: string) => ({ address: token.address, abi: token.abi, functionName })
  const query = useReadContracts({
    contracts: [
      paymentCall('packPrice'),
      paymentCall('MIN_PACKS'),
      paymentCall('MAX_PACKS'),
      paymentCall('REFUND_DELAY'),
      paymentCall('FEE_BPS'),
      paymentCall('claudeProUsdE8'),
      paymentCall('imdMidUsdE8'),
      paymentCall('floatTargetUsdE8'),
      paymentCall('settlementRecipient'),
      paymentCall('imd'),
      tokenCall('symbol'),
      tokenCall('decimals'),
    ],
    allowFailure: false,
    query: { staleTime: Infinity, retry: 2 },
  })
  const r = query.data as unknown[] | undefined
  const facts: ContractFacts | undefined = r
    ? {
        packPrice: r[0] as bigint,
        minPacks: Number(r[1]),
        maxPacks: Number(r[2]),
        refundDelay: r[3] as bigint,
        feeBps: r[4] as bigint,
        claudeProUsdE8: r[5] as bigint,
        imdMidUsdE8: r[6] as bigint,
        floatTargetUsdE8: r[7] as bigint,
        settlementRecipient: r[8] as Address,
        tokenAddress: r[9] as Address,
        tokenSymbol: r[10] as string,
        tokenDecimals: Number(r[11]),
      }
    : undefined
  return { facts, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}

/** Live quote for a pack count from the contract itself. */
export function useQuote(packs: number) {
  const { payment } = useRuntimeConfig()
  const query = useReadContract({
    address: payment.address,
    abi: payment.abi,
    functionName: 'quote',
    args: [packs],
    query: { enabled: packs >= 1 && packs <= 3, staleTime: Infinity },
  })
  return { quote: query.data as bigint | undefined, isLoading: query.isLoading, error: query.error }
}

/** Live wallet state: IMD balance and allowance for the payment contract, polled. */
export function useWalletTokenState(owner: Address | undefined) {
  const { payment, token } = useRuntimeConfig()
  const enabled = Boolean(owner)
  const balance = useReadContract({
    address: token.address,
    abi: token.abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    query: { enabled, refetchInterval: POLL_INTERVAL_MS },
  })
  const allowance = useReadContract({
    address: token.address,
    abi: token.abi,
    functionName: 'allowance',
    args: owner ? [owner, payment.address] : undefined,
    query: { enabled, refetchInterval: POLL_INTERVAL_MS },
  })
  return {
    balance: balance.data as bigint | undefined,
    allowance: allowance.data as bigint | undefined,
    isLoading: balance.isLoading || allowance.isLoading,
    error: balance.error ?? allowance.error,
    refetch: async () => {
      await Promise.all([balance.refetch(), allowance.refetch()])
    },
  }
}

export interface Receipt {
  amount: bigint
  paidAt: bigint
  packs: number
}

/** On-chain receipt for (payer, orderId); all zeros mean no payment. */
export function useReceipt(payer: Address | undefined, orderId: Hex | undefined, poll = false) {
  const { payment } = useRuntimeConfig()
  const enabled = Boolean(payer && orderId)
  const query = useReadContract({
    address: payment.address,
    abi: payment.abi,
    functionName: 'receipts',
    args: payer && orderId ? [payer, orderId] : undefined,
    query: { enabled, refetchInterval: poll ? POLL_INTERVAL_MS : false },
  })
  const raw = query.data as readonly [bigint, bigint, number] | undefined
  const receipt: Receipt | null | undefined = raw
    ? raw[0] === 0n
      ? null
      : { amount: raw[0], paidAt: raw[1], packs: Number(raw[2]) }
    : undefined
  return { receipt, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}
