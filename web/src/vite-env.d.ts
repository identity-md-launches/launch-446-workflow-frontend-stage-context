/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional public operator service base URL (no credentials). Empty disables it. */
  readonly VITE_OPERATOR_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
