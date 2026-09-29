import type { WalletAddChain } from '../config'

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

interface RpcErrorLike {
  code?: number
  data?: { originalError?: { code?: number } }
  message?: string
}

/** True when the wallet reports it does not know the chain (EIP-3085/3326 code 4902 or equivalents). */
export function isUnknownChainError(error: unknown): boolean {
  const e = error as RpcErrorLike | null
  if (!e) return false
  const code = e.code ?? e.data?.originalError?.code
  if (code === 4902 || code === -32603) return true
  const message = String(e.message ?? '').toLowerCase()
  return message.includes('unrecognized chain') || message.includes('unknown chain') || message.includes('not added')
}

export type EnsureChainResult = 'already' | 'switched' | 'added'

/**
 * Switch the wallet to the configured chain. When the wallet does not know it, offer
 * wallet_addEthereumChain with the vetted parameters, then switch again.
 */
export async function ensureChain(
  provider: Eip1193Provider,
  chainIdHex: string,
  walletAddChain: WalletAddChain | null,
): Promise<EnsureChainResult> {
  const current = String(await provider.request({ method: 'eth_chainId' }))
  if (current.toLowerCase() === chainIdHex.toLowerCase()) return 'already'
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    return 'switched'
  } catch (error) {
    if (!isUnknownChainError(error)) throw error
    if (!walletAddChain) {
      throw new Error('Your wallet does not know this network and no add-network parameters are configured.')
    }
    await provider.request({ method: 'wallet_addEthereumChain', params: [walletAddChain] })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    return 'added'
  }
}
