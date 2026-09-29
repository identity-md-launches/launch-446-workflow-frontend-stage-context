# DESIGN.md — Get a spend card (IdentityMD)

Extracted from the final source in `web/src/styles.css` and the components under `web/src/`. This documents what is implemented so another page can be added that belongs to the same product. The assignment's write scope excludes the repository root, so this file lives in `docs/`.

## Overview

Audience: a wallet user on the Sepolia test network buying one to three Claude-month spend-card packs with IMD. The interface is a calm, single-column transactional form: one page per task (pay, status, claim), one filled primary action per view, everything else neutral. Hierarchy comes from size and weight, not decoration; grouping comes from space and subtle surfaces, with borders reserved for structure (cards, inputs, dividers). Light and dark schemes follow the system preference; there is no theme toggle. Copy is sentence case, verb-first on buttons, and never names the DEX, stablecoins or card vendor.

System-wide rules: one content column capped at `--content-width` (44rem), cards as the unit of grouping, semantic color tokens only, 4px spacing scale, 44px controls. Page-specific arrangements (the four-step progress chips, the three-column pack picker) are patterns, not requirements for future pages.

## Colors

Source: `web/src/styles.css` `:root` and the `@media (prefers-color-scheme: dark)` block. Primitives were generated from an OKLCH ramp (constant hue, even perceived lightness, chroma peaking mid-ramp) and stored as hex; only the steps a role consumes are declared.

Primitive ramps (hex): `--neutral-50…950` (hue 255, near-gray), `--accent-100…950` (blue, hue 255), `--success-100/300/700/950`, `--danger-100/300/600/700/950`, `--warning-100/300/800/950`. Components never reference primitives.

Semantic tokens and their jobs (light → dark):

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--color-bg-page` | page background | `#f8fafd` | `#13161b` |
| `--color-bg-surface` | cards, header, inputs | `#ffffff` | `#25292f` |
| `--color-bg-subtle` | summary panel, code chips, badges | `#f1f4f7` | `#3a4048` |
| `--color-bg-hover` | hover fill on neutral controls | `#e3e6eb` | `#4f565e` |
| `--color-text-primary` | headings, body | `#25292f` | `#f1f4f7` |
| `--color-text-secondary` | labels, nav, secondary copy | `#4f565e` | `#d0d5da` |
| `--color-text-muted` | hints, captions, placeholders | `#666c75` | `#a9aeb6` |
| `--color-border` / `--color-border-strong` | structural borders / input and pill borders | `#e3e6eb` / `#d0d5da` | `#3a4048` / `#4f565e` |
| `--color-accent-solid` + `--color-on-accent` | the one filled primary action per view | `#0065e0` + white | `#66b0ff` + `#13161b` |
| `--color-accent-text`, `--color-accent-bg`, `--color-accent-border` | links, active nav, selected pack, current step | `#004cc3`, `#e2f6ff`, `#aad8ff` | `#aad8ff`, `#00094f`, `#004cc3` |
| `--color-focus` | 2px focus ring | `#1384f8` | `#66b0ff` |
| `--color-success-*` | confirmed approval/payment, "Paid on-chain" | text `#006d0c` on `#e7f9ea` | `#b0e3ba` on `#002100` |
| `--color-danger-*` | errors, wrong-network chip | text `#ab0005` on `#ffece9` | `#ffbeb7` on `#3f0000` |
| `--color-warning-*` | testnet badge, cautions, deadline passed | text `#722200` on `#fff1df` | `#f6cc9d` on `#320200` |

Measured rendered pairs (Chromium, `docs/validation.md`): all fifteen sampled text/background pairs pass WCAG AA in both schemes; the lowest are muted text on the page background (5.06:1) and the hint on the dark surface (6.55:1). Blue means interactive or selected; green means confirmed; red means error; amber means caution/testnet. No hue is reused for a second meaning.

## Typography

System stack only, no web fonts: `--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`; `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace` for addresses, hashes and commit ids. Weights used: 400 body, 500 nav, 600 labels/buttons/h3, 650 h2/brand, 700 h1.

Scale (`styles.css`): `--text-caption` 13px (hints, badges, chip steps), `--text-label` 14px (labels, buttons, nav, summary rows, footer), `--text-body` 16px (body and every input, so iOS does not zoom), `--text-lead` 18px (h3), `--text-title` 22px (h2), `--text-display` 28px (h1, letter-spacing −0.01em). Headings use `line-height: 1.15` and `text-wrap: balance`; paragraphs use `1.55`, `text-wrap: pretty` and a `65ch` measure. Changing values (prices, balances, countdowns, block number) use `.num` → `font-variant-numeric: tabular-nums`. Long identifiers use `overflow-wrap: anywhere`; the address chip truncates to `0x7FfD…2721` with the full value in `title`, copy and explorer link. Links take underline metrics from the font (`text-underline-position: from-font`). Root sets `-webkit-font-smoothing: antialiased`.

## Layout

Spacing scale `--space-1…10` on a 4px base (4, 8, 12, 16, 20, 24, 32, 40px). Content column: `.container` (max 44rem, inline padding `max(16px, safe-area-inset)`). Primitives: `.stack` (16px column gap), `.stack-tight` (8px), `.cluster` (wrapping row, 12px), `.row-between`. Cards add 16px of internal spacing between blocks (`.card > * + *`) and pad 16px on narrow screens, 24px from 36rem up. Groups are separated by space first (16–24px between groups, 4–8px within), borders second.

Breakpoints come from content, not devices: `26rem` (order summary stacks label over value), `30rem` (pack picker becomes one column; footer definition lists become one column), `36rem` (card padding grows), `40rem` (site nav drops under the brand row), and an `auto-fit` grid for footer columns (16rem minimum) and fact lists (13rem). Logical properties (`inset-inline-start`, `margin-inline-start`, `padding-inline`) are used for direction-dependent spacing. Verified in the browser at 320, 390 and 1280px with no horizontal overflow; 200% native zoom and RTL were not checked.

## Elevation & Depth

Mostly flat. `.card` uses a 1px structural border plus `--shadow-card` (two soft transparent shadows: `0 1px 2px` at 4% and `0 4px 12px` at 5% black; 30%/35% in dark) for slight lift. Header and footer are separated by 1px borders. Notices, summary panels and badges are tonal (background token + matching border), not shadowed. No overlays or modals exist.

## Shapes

`--radius-control` 8px for buttons, inputs, notices, pack options, summary panels, order items and disclosure boxes; `--radius-card` 12px for cards; `--radius-pill` for badges and step chips; 6px on inline code chips. The 8px control radius sits inside 12px cards with ≥16px padding, so nested corners never touch. Focus ring: `outline: 2px solid var(--color-focus); outline-offset: 2px` on `:focus-visible`, and `:has(input:focus-visible)` on the pack option cards.

## Components

- **Button** (`styles.css` `.btn`; used as native `<button>` or `<a>`): variants `.btn-primary` (accent fill, one per view), `.btn-secondary` (bordered), `.btn-ghost` (text), `.btn-icon` (44px square, `aria-label` required), `.btn-small` (36px), `.btn-block`. Min height 44px, 14px/600 text. States: hover fill only under `@media (hover: hover)`, `:active` `scale: 0.96` only when motion is allowed, `:disabled` at 55% opacity. Pending state: `<Spinner />` plus a verb label ("Confirm in wallet", "Approving", "Waiting for confirmation"); each on-chain action has its own pending flag.
- **Notice** (`components/ui.tsx`): `kind` info | success | warning | danger; renders an icon plus content; danger uses `role="alert"`, others `role="status"`. Errors always say what to do next and sit beside the action that failed.
- **AddressChip / CopyButton** (`components/ui.tsx`): checksummed truncated value in a code chip, copy button with a visually hidden polite "copied" announcement, explorer link (`address` or `tx` path) opening in a new tab.
- **NetworkBadge and wallet chip** (`components/Header.tsx`): `.badge-network` (amber, "Sepolia testnet"), `.badge-ok` (green, short address), `.badge-danger` ("Wrong network"), plus "Switch to Sepolia" and "Disconnect".
- **Pack option** (`pages/PayPage.tsx`, `.pack-option`): a `<label>` wrapping a native radio; selected state via `:has(input:checked)`; shows IMD price and USD context from the contract's quote rate.
- **Field** (`.field` + `.input`): visible `<label for>`, hint text linked by `aria-describedby`, inline `.error` with `aria-invalid`, 16px input text, 44px height.
- **Summary** (`.summary`): two-column definition list on a subtle panel, tabular numbers, stacks under 26rem.
- **Steps** (`.steps`): ordered list of pill chips; the current step has `aria-current="step"`, completed steps get a check mark and success tokens.
- **Order item** (`.order-item`, `pages/StatusPage.tsx` `ReceiptCard`): header row with reference chip and payer, status badge, `.facts` grid, notices for pending/failed/deadline-passed states.
- **Disclosure** (`details.disclosure`): native `<details>` for "How this works".
- **Skip link** (`.skip-link`): first tab stop, visible on focus, targets `main#main`.

## Do's and Don'ts

- Start a new page with `<div className="stack">`, an `h1` + muted lead paragraph, then one or more `.card` sections with an `h2` each; keep one `.btn-primary` per view.
- Use semantic color tokens only; add a new role token rather than borrowing one (never use a border token as text).
- Keep transaction buttons disabled while a prerequisite is unmet (no wallet, wrong chain, missing quote, insufficient balance) and give every on-chain action its own pending state.
- Put errors next to the control that failed with a stated fix; use `Notice kind="danger"` for errors and `warning` for cautions.
- Show amounts in IMD with `formatToken`; add USD only from the contract's quoted rate via `usdForToken`.
- Don't add web fonts, a second accent hue, a manual theme toggle, or motion beyond the 120ms color/scale transitions.
- Don't mention the DEX, stablecoins or the card vendor in product copy; the product term is "Get a spend card".
- Don't hard-code addresses, chain ids or RPC URLs; read them from the runtime config (`src/config.ts`).

Recipe for one more page: add a route in `hooks/useHashRoute.ts` (`ROUTES` + `parseRoute`), create `pages/NewPage.tsx` using `useRuntimeConfig()` and `useWallet()`, compose `.stack` → `.card` → `.field`/`.summary`/`Notice`, and render it from `App.tsx`. No new CSS is needed for a standard form or list page.
