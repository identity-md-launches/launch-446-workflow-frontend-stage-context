import { describe, expect, it } from 'vitest'
import { ensureChain, isUnknownChainError, type Eip1193Provider } from '../src/lib/wallet'
import type { WalletAddChain } from '../src/config'

const addChain: WalletAddChain = {
  chainId: '0xaa36a7',
  chainName: 'Sepolia',
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}

function mockProvider(opts: { chain: string; knows: boolean }) {
  const calls: { method: string; params?: unknown[] }[] = []
  let chain = opts.chain
  let knows = opts.knows
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      calls.push({ method, params })
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') {
        const target = (params?.[0] as { chainId: string }).chainId
        if (!knows && target === '0xaa36a7') throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })
        chain = target
        return null
      }
      if (method === 'wallet_addEthereumChain') {
        knows = true
        return null
      }
      throw new Error(`unexpected ${method}`)
    },
  }
  return { provider, calls }
}

describe('ensureChain', () => {
  it('does nothing when already on the chain', async () => {
    const { provider, calls } = mockProvider({ chain: '0xaa36a7', knows: true })
    expect(await ensureChain(provider, '0xaa36a7', addChain)).toBe('already')
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId'])
  })

  it('switches when the wallet knows the chain', async () => {
    const { provider, calls } = mockProvider({ chain: '0x1', knows: true })
    expect(await ensureChain(provider, '0xaa36a7', addChain)).toBe('switched')
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain'])
  })

  it('offers wallet_addEthereumChain with the vetted parameters after a 4902, then switches again', async () => {
    const { provider, calls } = mockProvider({ chain: '0x1', knows: false })
    expect(await ensureChain(provider, '0xaa36a7', addChain)).toBe('added')
    expect(calls.map((c) => c.method)).toEqual([
      'eth_chainId',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain',
    ])
    expect(calls[2].params?.[0]).toEqual(addChain)
  })

  it('rethrows other switch errors and refuses to add without parameters', async () => {
    const rejecting: Eip1193Provider = {
      async request({ method }) {
        if (method === 'eth_chainId') return '0x1'
        throw Object.assign(new Error('User rejected'), { code: 4001 })
      },
    }
    await expect(ensureChain(rejecting, '0xaa36a7', addChain)).rejects.toMatchObject({ code: 4001 })
    const { provider } = mockProvider({ chain: '0x1', knows: false })
    await expect(ensureChain(provider, '0xaa36a7', null)).rejects.toThrow(/no add-network parameters/)
  })

  it('recognises unknown-chain errors by code and message', () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true)
    expect(isUnknownChainError({ data: { originalError: { code: 4902 } } })).toBe(true)
    expect(isUnknownChainError({ message: 'Unrecognized chain ID 0xaa36a7' })).toBe(true)
    expect(isUnknownChainError({ code: 4001 })).toBe(false)
  })
})
