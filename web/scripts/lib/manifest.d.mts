// Type surface of manifest.mjs for the TypeScript test suite.
export interface ExportedFile {
  path: string
  bytes: Uint8Array
}

export interface ManifestContract {
  name: string
  address: string
  abiHash: string
  abiPath: string
}

export interface Manifest {
  version: 1
  launchId: string
  chainId: number
  sourceCommit: string
  attestationHash: string
  contracts: ManifestContract[]
  assets: { path: string; sha256: string }[]
  network?: Record<string, unknown>
  walletAddChain?: Record<string, unknown>
  [key: string]: unknown
}

export const MAX_ASSETS: number
export const MAX_FILE_BYTES: number
export const EXPORT_BUDGET_BYTES: number
export const MANIFEST_NAME: string
export const ALLOWED_TOP_LEVEL: string[]
export function canonicalize(value: unknown): unknown
export function canonicalKeccak(abi: unknown): string
export function sha256Hex(bytes: Uint8Array): string
export function buildManifest(input: { handoff: Record<string, any>; networkFile: Record<string, any> | null; files: ExportedFile[] }): Manifest
export function validateManifest(manifest: Record<string, unknown>, options?: { files?: ExportedFile[] }): true
export function isRelativePath(p: unknown): boolean
export function stableJson(value: unknown): string
