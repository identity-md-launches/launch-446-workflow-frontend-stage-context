#!/usr/bin/env node
// Writes ../dist/imd-deployment.json after `vite build`: every exported file except the
// manifest itself is listed with its SHA-256, the contract set is copied from the handoff,
// ABI hashes are re-verified against the exported ABI JSON, and the network block is copied
// unchanged. `--check` validates the committed manifest against the current dist/ instead.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildManifest, MANIFEST_NAME, stableJson, validateManifest } from './lib/manifest.mjs'
import { loadInputs } from './prepare-config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '../../dist')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push({ path: relative(distDir, full).split('\\').join('/'), bytes: readFileSync(full) })
  }
  return out
}

const check = process.argv.includes('--check')
const { handoff, networkFile } = loadInputs()
const files = walk(distDir)
const manifest = buildManifest({ handoff, networkFile, files })
const text = stableJson(manifest)
const target = join(distDir, MANIFEST_NAME)

if (check) {
  const existing = readFileSync(target, 'utf8')
  validateManifest(JSON.parse(existing), { files })
  if (existing !== text) {
    console.error('dist/imd-deployment.json differs from the manifest generated for the current dist/')
    process.exit(1)
  }
  console.log(`dist/imd-deployment.json matches ${manifest.assets.length} assets and ${manifest.contracts.length} contracts`)
} else {
  writeFileSync(target, text)
  const total = files.reduce((n, f) => n + f.bytes.length, 0)
  console.log(`wrote ${relative(process.cwd(), target)}: ${manifest.assets.length} assets, ${total} bytes exported`)
}
