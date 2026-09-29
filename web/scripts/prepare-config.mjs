#!/usr/bin/env node
// Copies the implementation-derived ABIs (../docs/abi/<Contract>.json, pinned at the deployed
// source commit) into public/abi/ after verifying each canonical keccak hash against the
// handoff, and writes a development copy of imd-deployment.json (empty asset list) so
// `vite dev` serves the same runtime configuration shape the production export uses.
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalKeccak, stableJson } from './lib/manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const repoRoot = resolve(webRoot, '..')

export function loadInputs() {
  const handoff = JSON.parse(readFileSync(join(webRoot, 'deployment/handoff.json'), 'utf8'))
  const networkPath = join(webRoot, 'deployment/network.json')
  const networkFile = existsSync(networkPath) ? JSON.parse(readFileSync(networkPath, 'utf8')) : null
  return { handoff, networkFile }
}

export function readAbiBytes(name) {
  const path = join(repoRoot, 'docs/abi', `${name}.json`)
  if (!existsSync(path)) throw new Error(`missing ABI export ${path}`)
  return readFileSync(path)
}

function main() {
  const { handoff, networkFile } = loadInputs()
  const abiDir = join(webRoot, 'public/abi')
  rmSync(abiDir, { recursive: true, force: true })
  mkdirSync(abiDir, { recursive: true })

  const contracts = handoff.contracts.map((c) => {
    const bytes = readAbiBytes(c.name)
    const abi = JSON.parse(bytes.toString('utf8'))
    const hash = canonicalKeccak(abi)
    if (hash !== c.abiHash) {
      throw new Error(`ABI hash mismatch for ${c.name}: handoff ${c.abiHash}, docs/abi ${hash}`)
    }
    writeFileSync(join(abiDir, `${c.name}.json`), bytes)
    console.log(`ABI ${c.name}: ${hash} ok`)
    return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` }
  })

  const devManifest = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts,
    assets: [],
  }
  if (networkFile) {
    devManifest.network = networkFile.network
    if (networkFile.walletAddChain) devManifest.walletAddChain = networkFile.walletAddChain
  }
  writeFileSync(join(webRoot, 'public/imd-deployment.json'), stableJson(devManifest))
  console.log('wrote public/imd-deployment.json (development copy; assets are filled in after build)')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
