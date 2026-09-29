import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildManifest, canonicalKeccak, isRelativePath, validateManifest } from '../scripts/lib/manifest.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const handoff = JSON.parse(readFileSync(join(here, '../deployment/handoff.json'), 'utf8'))
const networkFile = JSON.parse(readFileSync(join(here, '../deployment/network.json'), 'utf8'))
const abis: Record<string, Buffer> = Object.fromEntries(
  handoff.contracts.map((c: { name: string }) => [c.name, readFileSync(join(here, '../../docs/abi', `${c.name}.json`))]),
)

function files() {
  return [
    { path: 'index.html', bytes: Buffer.from('<!doctype html>') },
    { path: 'assets/app.js', bytes: Buffer.from('console.log(1)') },
    ...handoff.contracts.map((c: { name: string }) => ({ path: `abi/${c.name}.json`, bytes: abis[c.name] })),
  ]
}

describe('manifest', () => {
  it('computes the canonical keccak that matches the handoff for every ABI', () => {
    for (const c of handoff.contracts) {
      expect(canonicalKeccak(JSON.parse(abis[c.name].toString()))).toBe(c.abiHash)
    }
  })

  it('builds a manifest with only the allowed keys and the network block copied unchanged', () => {
    const m = buildManifest({ handoff, networkFile, files: files() })
    expect(Object.keys(m)).toEqual(['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network', 'walletAddChain'])
    expect(m.network).toEqual(networkFile.network)
    expect(m.walletAddChain).toEqual(networkFile.walletAddChain)
    expect(m.contracts.map((c: { name: string }) => c.name)).toEqual(handoff.contracts.map((c: { name: string }) => c.name))
    expect(m.assets.map((a: { path: string }) => a.path)).toEqual(['abi/ImdCardPayment.json', 'abi/LaunchToken.json', 'assets/app.js', 'index.html'])
    expect(m.assets.every((a: { sha256: string }) => /^[0-9a-f]{64}$/.test(a.sha256))).toBe(true)
  })

  it('rejects tampered ABIs, extra keys, foreign addresses and URLs', () => {
    const tampered = files().map((f) => (f.path === 'abi/LaunchToken.json' ? { ...f, bytes: Buffer.from('[]') } : f))
    expect(() => buildManifest({ handoff, networkFile, files: tampered })).toThrow(/ABI hash mismatch/)

    const m = buildManifest({ handoff, networkFile, files: files() })
    expect(() => validateManifest({ ...m, pool: {} })).toThrow(/unexpected top-level key/)
    expect(() => validateManifest({ ...m, launchId: 'https://example.com' })).toThrow(/URL/)
    expect(() => validateManifest({ ...m, sourceCommit: '0x1234567890123456789012345678901234567890' })).toThrow(/address/)
    expect(() => validateManifest({ ...m, assets: m.assets.filter((a: { path: string }) => a.path !== 'index.html') })).toThrow(/index.html/)
  })

  it('detects hash drift and unlisted files against the export', () => {
    const m = buildManifest({ handoff, networkFile, files: files() })
    const drifted = files().map((f) => (f.path === 'index.html' ? { ...f, bytes: Buffer.from('changed') } : f))
    expect(() => validateManifest(m, { files: drifted })).toThrow(/hash mismatch/)
    expect(() => validateManifest(m, { files: [...files(), { path: 'extra.txt', bytes: Buffer.from('x') }] })).toThrow(/not listed/)
  })

  it('accepts only relative paths', () => {
    expect(isRelativePath('abi/X.json')).toBe(true)
    expect(isRelativePath('/abi/X.json')).toBe(false)
    expect(isRelativePath('../X.json')).toBe(false)
    expect(isRelativePath('https://x/y.json')).toBe(false)
  })
})
