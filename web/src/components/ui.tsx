import { useEffect, useState, type ReactNode } from 'react'
import { useRuntimeConfig } from '../hooks/useContracts'
import { checksum, shortAddress, shortHex } from '../lib/format'

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export type NoticeKind = 'info' | 'success' | 'warning' | 'danger'

const ICONS: Record<NoticeKind, ReactNode> = {
  info: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v5M10 6.5v.5" strokeLinecap="round" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="m6.5 10.5 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10 3.5 17 16H3z" strokeLinejoin="round" />
      <path d="M10 8v4M10 14v.5" strokeLinecap="round" />
    </svg>
  ),
  danger: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.5 7.5 5 5m0-5-5 5" strokeLinecap="round" />
    </svg>
  ),
}

/** Inline notice. Errors use role="alert"; everything else is a polite status region. */
export function Notice({ kind, children, id }: { kind: NoticeKind; children: ReactNode; id?: string }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'danger' ? 'alert' : 'status'} id={id}>
      {ICONS[kind]}
      <div>{children}</div>
    </div>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12" />
      <path d="M11 4h5v5M16 4l-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Copy button with a polite "Copied" announcement. */
export function CopyButton({ value, label, small = true }: { value: string; label: string; small?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <>
      <button
        type="button"
        className={`btn btn-icon${small ? ' btn-small' : ''}`}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      >
        <CopyIcon />
      </button>
      <span className="visually-hidden" role="status">
        {copied ? `${label} copied to clipboard` : ''}
      </span>
    </>
  )
}

/** Checksummed short address with copy and explorer link. */
export function AddressChip({ address, label, kind = 'address' }: { address: string; label: string; kind?: 'address' | 'tx' }) {
  const { explorer } = useRuntimeConfig()
  const full = kind === 'address' ? checksum(address) : address
  const short = kind === 'address' ? shortAddress(full) : shortHex(full)
  return (
    <span className="address-chip">
      <code title={full}>{short}</code>
      <CopyButton value={full} label={label} />
      {explorer ? (
        <a
          className="btn btn-icon btn-small"
          href={`${explorer}/${kind}/${full}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`View ${label} on the block explorer`}
        >
          <ExternalIcon />
        </a>
      ) : null}
    </span>
  )
}

export function ExplorerLink({ path, children }: { path: string; children: ReactNode }) {
  const { explorer } = useRuntimeConfig()
  if (!explorer) return <>{children}</>
  return (
    <a href={`${explorer}/${path}`} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}
