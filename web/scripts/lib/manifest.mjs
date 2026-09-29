// Pure helpers shared by prepare-config.mjs, write-manifest.mjs and the unit tests.
// No file-system access here so the logic can be tested in isolation.
import { createHash } from 'node:crypto'
import { keccak256, stringToHex } from 'viem'

export const MAX_ASSETS = 128
export const MAX_FILE_BYTES = 8 * 1024 * 1024
// The publication checker has a 64 MiB total body budget; keep the export well below half.
export const EXPORT_BUDGET_BYTES = 24 * 1024 * 1024
export const MANIFEST_NAME = 'imd-deployment.json'
export const ALLOWED_TOP_LEVEL = [
  'version',
  'launchId',
  'chainId',
  'sourceCommit',
  'attestationHash',
  'contracts',
  'assets',
  'network',
  'walletAddChain',
]

/** Recursively sort object keys so JSON.stringify is canonical. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

/** keccak256 of the key-sorted compact JSON encoding, as 64 lowercase hex chars without 0x. */
export function canonicalKeccak(abi) {
  return keccak256(stringToHex(JSON.stringify(canonicalize(abi)))).slice(2)
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const HEX64 = /^[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * Build the manifest object from the handoff, the optional network file and the list of
 * exported files ({ path, bytes }). Throws on any inconsistency.
 */
export function buildManifest({ handoff, networkFile, files }) {
  if (handoff.version !== 1) throw new Error(`unsupported handoff version ${handoff.version}`)
  const abiByPath = new Map(files.map((f) => [f.path, f]))
  const contracts = handoff.contracts.map((c) => {
    const abiPath = `abi/${c.name}.json`
    const file = abiByPath.get(abiPath)
    if (!file) throw new Error(`missing exported ABI ${abiPath}`)
    const abi = JSON.parse(Buffer.from(file.bytes).toString('utf8'))
    if (!Array.isArray(abi)) throw new Error(`${abiPath} is not a JSON array`)
    const hash = canonicalKeccak(abi)
    if (hash !== c.abiHash) {
      throw new Error(`ABI hash mismatch for ${c.name}: handoff ${c.abiHash}, computed ${hash}`)
    }
    return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath }
  })

  const assets = files
    .filter((f) => f.path !== MANIFEST_NAME)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => ({ path: f.path, sha256: sha256Hex(f.bytes) }))

  const manifest = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts,
    assets,
  }
  if (networkFile) {
    manifest.network = networkFile.network
    if (networkFile.walletAddChain) manifest.walletAddChain = networkFile.walletAddChain
  }
  validateManifest(manifest, { files })
  return manifest
}

/**
 * The same shape checks the publisher applies: only allowed top-level keys, hex fields,
 * relative paths, size limits, and no address/URL outside the handoff and network block.
 */
export function validateManifest(manifest, { files } = {}) {
  const errors = []
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_TOP_LEVEL.includes(key)) errors.push(`unexpected top-level key "${key}"`)
  }
  if (manifest.version !== 1) errors.push('version must be 1')
  if (typeof manifest.launchId !== 'string' || !manifest.launchId) errors.push('launchId missing')
  if (!Number.isInteger(manifest.chainId)) errors.push('chainId must be an integer')
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) errors.push('sourceCommit must be a 40-hex commit')
  if (!HEX64.test(manifest.attestationHash)) errors.push('attestationHash must be 64 lowercase hex')
  if (!Array.isArray(manifest.contracts) || manifest.contracts.length === 0) errors.push('contracts missing')
  if (!Array.isArray(manifest.assets)) errors.push('assets missing')

  const contractAddresses = new Set()
  for (const c of manifest.contracts ?? []) {
    const keys = Object.keys(c).sort().join(',')
    if (keys !== 'abiHash,abiPath,address,name') errors.push(`contract ${c.name}: keys must be name,address,abiHash,abiPath`)
    if (!ADDRESS.test(c.address ?? '')) errors.push(`contract ${c.name}: bad address`)
    if (!HEX64.test(c.abiHash ?? '')) errors.push(`contract ${c.name}: abiHash must be 64 lowercase hex`)
    if (!isRelativePath(c.abiPath)) errors.push(`contract ${c.name}: abiPath must be relative to dist/`)
    contractAddresses.add(String(c.address).toLowerCase())
  }

  const assetPaths = new Set()
  for (const a of manifest.assets ?? []) {
    if (!isRelativePath(a.path)) errors.push(`asset ${a.path}: path must be relative to dist/`)
    if (a.path === MANIFEST_NAME) errors.push('manifest must not list itself')
    if (!HEX64.test(a.sha256 ?? '')) errors.push(`asset ${a.path}: sha256 must be 64 lowercase hex`)
    if (assetPaths.has(a.path)) errors.push(`asset ${a.path}: duplicate`)
    assetPaths.add(a.path)
  }
  if ((manifest.assets ?? []).length > MAX_ASSETS) errors.push(`more than ${MAX_ASSETS} assets`)
  if (!assetPaths.has('index.html')) errors.push('index.html must be listed')
  for (const c of manifest.contracts ?? []) {
    if (!assetPaths.has(c.abiPath)) errors.push(`ABI ${c.abiPath} must be listed as an asset`)
  }

  if (files) {
    const byPath = new Map(files.map((f) => [f.path, f]))
    let total = 0
    for (const f of files) {
      if (f.path === MANIFEST_NAME) continue
      total += f.bytes.length
      if (f.bytes.length > MAX_FILE_BYTES) errors.push(`${f.path} exceeds 8 MiB`)
      if (!assetPaths.has(f.path)) errors.push(`exported file ${f.path} is not listed`)
    }
    for (const a of manifest.assets ?? []) {
      const f = byPath.get(a.path)
      if (!f) errors.push(`listed asset ${a.path} is not exported`)
      else if (sha256Hex(f.bytes) !== a.sha256) errors.push(`hash mismatch for ${a.path}`)
    }
    if (total > EXPORT_BUDGET_BYTES) errors.push(`export is ${total} bytes, above the ${EXPORT_BUDGET_BYTES} budget`)
  }

  // No address or URL may appear outside the handoff contracts and the network block.
  const networkText = JSON.stringify(manifest.network ?? null) + JSON.stringify(manifest.walletAddChain ?? null)
  const networkAddresses = new Set((networkText.match(/0x[0-9a-fA-F]{40}/g) ?? []).map((a) => a.toLowerCase()))
  const rest = JSON.stringify({ ...manifest, network: undefined, walletAddChain: undefined, contracts: undefined })
  for (const found of rest.match(/0x[0-9a-fA-F]{40}/g) ?? []) {
    if (!contractAddresses.has(found.toLowerCase()) && !networkAddresses.has(found.toLowerCase())) {
      errors.push(`address ${found} appears outside the handoff and network block`)
    }
  }
  for (const found of rest.match(/[a-z]+:\/\/[^"\s]+/gi) ?? []) {
    errors.push(`URL ${found} appears outside the network block`)
  }
  if (errors.length) throw new Error(`manifest invalid:\n - ${errors.join('\n - ')}`)
  return true
}

export function isRelativePath(p) {
  if (typeof p !== 'string' || !p) return false
  if (p.startsWith('/') || p.startsWith('\\')) return false
  if (/^[a-z]+:/i.test(p)) return false
  return !p.split(/[\\/]/).some((seg) => seg === '..' || seg === '')
}

export function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n'
}
