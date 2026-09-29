import { useCallback, useMemo, useState } from 'react'
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi'
import { useRuntimeConfig } from './useContracts'
import { describeError } from '../lib/errors'
import { ensureChain, type Eip1193Provider } from '../lib/wallet'

/**
 * Wallet connection state for the whole app: connectors to offer, connect/disconnect,
 * whether the wallet is on the configured chain, and the explicit switch/add flow.
 */
export function useWallet() {
  const config = useRuntimeConfig()
  const account = useAccount()
  const { connectAsync, isPending: isConnecting } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const allConnectors = useConnectors()
  const [error, setError] = useState<string | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)

  // Prefer EIP-6963 discovered wallets; keep the generic injected connector only when nothing
  // else exists and a provider is present.
  const connectors = useMemo(() => {
    const discovered = allConnectors.filter((c) => c.id !== 'injected')
    if (discovered.length > 0) return discovered
    const hasProvider = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum)
    return hasProvider ? allConnectors.filter((c) => c.id === 'injected') : []
  }, [allConnectors])

  const onChain = account.isConnected && account.chainId === config.chain.id

  const connect = useCallback(
    async (connectorId?: string) => {
      setError(null)
      const connector = connectors.find((c) => c.id === connectorId) ?? connectors[0]
      if (!connector) {
        setError('No browser wallet detected. Install a wallet extension, then reload the page.')
        return
      }
      try {
        await connectAsync({ connector })
      } catch (e) {
        setError(describeError(e, 'Unable to connect the wallet. Try again.'))
      }
    },
    [connectAsync, connectors],
  )

  const disconnect = useCallback(async () => {
    setError(null)
    try {
      await disconnectAsync()
    } catch (e) {
      setError(describeError(e))
    }
  }, [disconnectAsync])

  const switchToChain = useCallback(async () => {
    setError(null)
    if (!account.connector) return
    setIsSwitching(true)
    try {
      const provider = (await account.connector.getProvider()) as Eip1193Provider
      await ensureChain(provider, config.chainIdHex, config.walletAddChain)
    } catch (e) {
      setError(describeError(e, `Unable to switch to ${config.chain.name}. Switch networks in your wallet and try again.`))
    } finally {
      setIsSwitching(false)
    }
  }, [account.connector, config.chain.name, config.chainIdHex, config.walletAddChain])

  return {
    address: account.address,
    chainId: account.chainId,
    isConnected: account.isConnected,
    isConnecting: isConnecting || account.status === 'connecting' || account.status === 'reconnecting',
    onChain,
    connectors,
    connect,
    disconnect,
    switchToChain,
    isSwitching,
    error,
    clearError: () => setError(null),
  }
}
