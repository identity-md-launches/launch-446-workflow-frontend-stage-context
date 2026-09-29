// Single place for deployment configuration. Nothing here hard-codes an address, chain id,
// RPC URL or ABI: they are read at runtime from ./imd-deployment.json (the committed
// manifest in dist/) and the ABI files it references, so the app can never disagree with
// the attested handoff. Public, credential-free build-time options live at the bottom.
import { createConfig, fallback, http, injected, unstable_connector, type Config } from 'wagmi'
import { defineChain, keccak256, stringToHex, type Abi, type Address, type Chain } from 'viem'

export interface ManifestContract {
  name: string
  address: Address
  abiHash: string
  abiPath: string
}

export interface NetworkBlock {
  chainId: number
  name: string
  testnet: boolean
  rpcUrls: string[]
  explorer: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  faucets?: string[]
  uniswapV4?: {
    poolManager: Address
    universalRouter: Address
    quoter: Address
    stateView: Address
    positionManager: Address
    permit2: Address
  }
}

export interface WalletAddChain {
  chainId: string
  chainName: string
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  blockExplorerUrls?: string[]
}

export interface DeploymentManifest {
  version: 1
  launchId: string
  chainId: number
  sourceCommit: string
  attestationHash: string
  contracts: ManifestContract[]
  assets: { path: string; sha256: string }[]
  network?: NetworkBlock
  walletAddChain?: WalletAddChain
}

export interface ContractBinding {
  name: string
  address: Address
  abi: Abi
  abiHash: string
}

export interface RuntimeConfig {
  manifest: DeploymentManifest
  chain: Chain
  chainIdHex: string
  network: NetworkBlock | null
  walletAddChain: WalletAddChain | null
  explorer: string | null
  rpcUrls: string[]
  payment: ContractBinding
  token: ContractBinding
  wagmi: Config
}

/** Contract names the app expects in the handoff. */
export const PAYMENT_CONTRACT = 'ImdCardPayment'
export const TOKEN_CONTRACT = 'LaunchToken'

/** Read polling for live contract state (ms). Keeps request volume low and steady. */
export const POLL_INTERVAL_MS = 4000

/** Optional public operator service for order intake, status and card claims. */
export const OPERATOR_API_URL = (import.meta.env.VITE_OPERATOR_API_URL ?? '').trim().replace(/\/+$/, '')

export class ConfigError extends Error {}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((key) => [key, canonicalize(obj[key])]),
    )
  }
  return value
}

/** keccak256 of the key-sorted compact JSON, 64 lowercase hex characters, no 0x. */
export function canonicalAbiHash(abi: unknown): string {
  return keccak256(stringToHex(JSON.stringify(canonicalize(abi)))).slice(2)
}

function resolveRelative(path: string): URL {
  return new URL(path, document.baseURI)
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(resolveRelative(path), { cache: 'no-cache' })
  if (!response.ok) throw new ConfigError(`Unable to load ${path} (HTTP ${response.status})`)
  return response.json()
}

function assertManifest(value: unknown): DeploymentManifest {
  const m = value as Partial<DeploymentManifest> | null
  if (!m || typeof m !== 'object') throw new ConfigError('imd-deployment.json is not an object')
  if (m.version !== 1) throw new ConfigError(`imd-deployment.json version ${String(m.version)} is not supported`)
  if (!Number.isInteger(m.chainId)) throw new ConfigError('imd-deployment.json has no numeric chainId')
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) throw new ConfigError('imd-deployment.json lists no contracts')
  for (const c of m.contracts) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(c.address)) throw new ConfigError(`Contract ${c.name} has an invalid address`)
    if (!/^[0-9a-f]{64}$/.test(c.abiHash)) throw new ConfigError(`Contract ${c.name} has an invalid abiHash`)
    if (typeof c.abiPath !== 'string' || c.abiPath.startsWith('/') || c.abiPath.includes('..') || /^[a-z]+:/i.test(c.abiPath)) {
      throw new ConfigError(`Contract ${c.name} has an invalid abiPath`)
    }
  }
  if (m.network && m.network.chainId !== m.chainId) {
    throw new ConfigError('network.chainId does not match the deployment chainId')
  }
  return m as DeploymentManifest
}

async function bindContract(entry: ManifestContract): Promise<ContractBinding> {
  const abi = await fetchJson(entry.abiPath)
  if (!Array.isArray(abi)) throw new ConfigError(`${entry.abiPath} is not an ABI array`)
  const hash = canonicalAbiHash(abi)
  if (hash !== entry.abiHash) {
    throw new ConfigError(`ABI at ${entry.abiPath} does not match the attested hash for ${entry.name}`)
  }
  return { name: entry.name, address: entry.address, abi: abi as Abi, abiHash: entry.abiHash }
}

function buildChain(manifest: DeploymentManifest): Chain {
  const network = manifest.network
  if (!network) {
    return defineChain({
      id: manifest.chainId,
      name: `Chain ${manifest.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [] } },
    })
  }
  return defineChain({
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
  })
}

/**
 * Load the runtime deployment configuration and build the wagmi config from it.
 * Reads go through the vetted public RPC endpoints with the wallet provider as a last
 * fallback; transaction signing always stays in the visitor's wallet.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const manifest = assertManifest(await fetchJson('imd-deployment.json'))
  const paymentEntry = manifest.contracts.find((c) => c.name === PAYMENT_CONTRACT)
  const tokenEntry = manifest.contracts.find((c) => c.name === TOKEN_CONTRACT)
  if (!paymentEntry || !tokenEntry) {
    throw new ConfigError(`imd-deployment.json must list ${PAYMENT_CONTRACT} and ${TOKEN_CONTRACT}`)
  }
  const [payment, token] = await Promise.all([bindContract(paymentEntry), bindContract(tokenEntry)])
  const chain = buildChain(manifest)
  const rpcUrls = manifest.network?.rpcUrls ?? []
  const transports = rpcUrls.length
    ? fallback([...rpcUrls.map((url) => http(url, { batch: true })), unstable_connector(injected)])
    : unstable_connector(injected)

  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    pollingInterval: POLL_INTERVAL_MS,
    transports: { [chain.id]: transports },
  })

  return {
    manifest,
    chain,
    chainIdHex: `0x${chain.id.toString(16)}`,
    network: manifest.network ?? null,
    walletAddChain: manifest.walletAddChain ?? null,
    explorer: manifest.network?.explorer ?? null,
    rpcUrls,
    payment,
    token,
    wagmi,
  }
}
