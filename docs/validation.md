# Frontend validation record

Worker-side evidence for the "Get a spend card" frontend (assignment `ae58b1c0-1b80-45a6-b842-4969b1a2048e`). This is the worker's report, not an independent network certification. Nothing here was verified by broadcasting a real transaction.

## 1. Scope and assumptions

- Pages: `#/` (pack picker, email, connect/switch/approve/pay), `#/status` (local orders with live receipts, refund countdown, manual lookup), `#/claim` (paid orders, email delivery guidance, optional operator claim form). Hash routing, relative base, export in `dist/`.
- Deployment handoff: `.imd/reads/deployment.json` (launch `a36cb67d-208f-4149-a31a-4a55cac4833c`, chain 11155111, source commit `1e0ac5e9…`, contracts `LaunchToken` `0x10a7…613f` and `ImdCardPayment` `0x7ffd…2721`). Both ABI hashes from `docs/abi/` at that commit match the handoff (keccak of key-sorted compact JSON). Checked with `cast`: chain id 11155111, nonzero code at both addresses, `quote(1)` = 2160 IMD, `symbol()` = IMD.
- `.imd/reads/network.json` present; its `network` and `walletAddChain` blocks are copied byte for byte into `dist/imd-deployment.json`.
- **Swaps deliberately not implemented.** `.imd/reads/workflow.md` (the approved requirements) states "Wallet may only approve/pay IMD" and "Copy only 'Get a spend card' — never Uniswap, USDC, or Bitrefill". The app therefore has no swap, quote-from-pool or Permit2 flow; the Uniswap v4 addresses travel unchanged in the manifest's `network` block only. The generic acceptance line about swaps/quotes/approvals using those addresses is vacuous for this product, and the criterion about `wallet_addEthereumChain` is implemented and tested.
- Operator backend: none is supplied. Email and order references are stored in the browser; an optional `VITE_OPERATOR_API_URL` integration (intake, status, claim) is implemented but disabled by default. The claim page without a backend explains email delivery and the refund obligation.
- USD context uses only the contract's on-chain quote inputs (`claudeProUsdE8`, `imdMidUsdE8`); no external price.
- `DESIGN.md` is at `docs/DESIGN.md` because the repository root is outside this assignment's write scope (`web/**`, `dist/**`, `docs/**`).
- Open Graph image: not set; the live domain/gateway is unknown at this stage, so only title/description/type metadata are present (reported as pending per the eth-frontend-ux adapter).

## 2. Coverage (Better Interface, six domains)

| Domain | Status | Inspected | Not verified |
| --- | --- | --- | --- |
| Accessibility | Checked | Native elements throughout; single `h1` per page; `main` landmark and skip link first in tab order; every icon button has `aria-label`; labels bound to inputs; `aria-invalid` + `aria-describedby` on errors with focus moved to the field; `role="alert"`/`role="status"` split; reduced-motion guard on spinner and press scale (verified computed `animation-name: none`); keyboard walk of the pay page with a 2px ring at every stop; axe-core 4.x automated audit on pay (light), status, claim and payment-received states: no violations. | Real screen-reader session; native 200% zoom; physical touch devices; forced-colors mode. |
| Layout | Checked | 320, 390 and 1280px: no horizontal overflow on pay and status pages; controls ≥44px; logical properties; content-driven breakpoints. | RTL mirror; 200% zoom; widths between 390 and 1280 other than by inference from the auto-fit grids. |
| Writing | Checked (source) | Verb-first buttons, sentence case, errors with a next step beside the control, empty states pointing forward, consistent terms ("pack", "order reference", "Approve/Pay"). Product copy avoids DEX/stablecoin/vendor names (asserted in the browser run). | — |
| Typography | Checked | Descending heading sizes, 16px inputs at mobile widths (measured), tabular numbers on changing values, balanced headings, measure cap, truncation with full value reachable. | Wrapping at every intermediate width. |
| Colors | Checked | Semantic tokens only; one accent; fifteen rendered text/background pairs measured in light and dark, all ≥4.5:1 (lowest 5.06:1, muted text on the page background). | Pairs not sampled (e.g. disabled button text, which is intentionally low-emphasis and non-interactive). |
| UI | Checked | Transitions name exact properties (≤120ms), press scale 0.96 behind reduced-motion, 8px controls inside 12px cards with ≥16px padding, borders for structure and soft shadows for card lift, icons from `currentColor` with 1.5px strokes beside 400–600 text. | Animation replay at 10% speed (no staged animations exist). |

## 3. Findings and fixes

| # | Severity | Location | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| 1 | MEDIUM (UI/writing) | `web/src/pages/PayPage.tsx` approve step | First browser run: after the approval confirmed and the step advanced to Pay, the "Approval confirmed + tx link" notice disappeared, leaving no record of the first transaction before the second confirmation. | Notice now renders during both approve and pay steps with the approved amount; cleared when the payment is sent or the pack count changes. | Second run: "Approval of 2,160 IMD confirmed. 0x…" visible on the pay step (`pay-pay-step.jpg`); cleared after choosing 3 packs. |
| 2 | MEDIUM (layout) | `web/src/styles.css` `.summary` | Screenshot at 320px: the label column squeezed to one word per line ("You / pay", "Refund / if no / card"). | Added a `26rem` breakpoint that stacks each label above its value, start-aligned. | Final run at 320px (`pay-mobile-320.jpg`). |
| 3 | LOW (layout) | `web/src/styles.css` `.order-item > .badge` | Screenshot: "Not paid"/"Paid on-chain" badge stretched to the full card width inside the flex column. | `align-self: flex-start`. | Final run (`status-paid.jpg`). |
| 4 | LOW (writing) | `web/src/pages/PayPage.tsx` | Simulation errors and wallet rejections were translated, but a reverted on-chain payment (receipt `status: reverted`) had no message. | Added an explicit reverted-receipt message and marks the local order failed. | Source only; a reverted receipt was not reproduced in the browser (see limitations). |

Test-harness artifacts (not defects): the first run counted wagmi's `wallet_requestPermissions` in the switch/add sequence, checked the approve label before the live `quote(3)` read returned, and tabbed past the last control onto `body`. The script was corrected; the UI was not changed for these.

## 4. Verification

Commands (from `web/`, Node 24.9, npm 11.6):

| Command | Result |
| --- | --- |
| `node scripts/prepare-config.mjs` | Both ABI hashes match the handoff (`38880b8e…37bee`, `c1aa992a…26f5`). |
| `npx tsc -p tsconfig.json --noEmit` | Exit 0. |
| `npx vitest run` | 5 files, 23 tests passed (format, error translation, order records, chain switch/add with a mock EIP-1193 provider, manifest build/validate against the real handoff and ABIs). |
| `npm run build` | Vite 8 production build: `index.html` 1.1 kB, CSS 16 kB, JS 609 kB (184 kB gzip) + 2.8 kB chunk; export 7 assets, ~644 kB total. `dist/imd-deployment.json` written. |
| `npm run verify-manifest` | Committed manifest matches the export; all listed hashes verified; only allowed top-level keys; no address or URL outside the handoff/network block. |

Rendered checks: `test/scratch/verify.mjs` (deleted before submission; Playwright 1.64 with the seat's Chromium 154) serves `dist/` under `http://127.0.0.1:<port>/preview/` (subpath, relative base), and runs three scenarios in one foreground command. Live Sepolia reads go to the configured public RPC; only the calls that would need funds are mocked (balance/allowance/receipts for the mock account, `eth_call` of `pay` for simulation, `eth_sendTransaction` in the injected mock wallet, and receipts for the resulting hashes). Final run: **83 checks passed, 0 failed**, no console errors, no failed resource loads (the favicon is excluded from that count and loaded fine).

- Scenario A, 1280×900, no wallet: live quote 2,160 IMD; title; single h1; disabled "Connect wallet" with a "No browser wallet detected" notice; footer shows on-chain quote inputs, latest block and three explorer links; copy check; overflow; contrast (light and dark); axe; keyboard walk (skip link first, 2px ring at 13 stops, email reachable); reduced-motion spinner; status and claim empty states with axe.
- Scenario B, 320×740 and 390×844 (mobile emulation): overflow on pay and status, 16px email input, 44px primary button.
- Scenario C, mocked wallet on chain 0x1 that does not know Sepolia: connect → "Wrong network" chip; "Switch to Sepolia" → `wallet_switchEthereumChain` (4902) → `wallet_addEthereumChain` with the manifest's `walletAddChain` (deep-equal) → `wallet_switchEthereumChain` → approve step with live balance (10,000 IMD ≈ $100.00) and allowance (0 IMD); approve → tx 1 → confirmed notice → Pay step; Pay with empty email → inline error, `aria-invalid`, focus on the field; simulated `PaymentExpired` revert → translated message and no transaction sent; Pay → tx 2 → "Payment received" with email and order reference (nonzero, 1 pack encoded); status page reads the receipt (amount, packs, paid-at, "Card due by … (15:00 left)"), lookup validation error and successful lookup by reference; claim page lists the paid order; second order: wallet rejection (4001) → "Request rejected in your wallet" with the button re-enabled; choosing 3 packs re-reads `quote(3)` = 6,480 IMD live and relabels the approve button.

Screenshots (`docs/validation/screenshots/`, JPEG, full page unless noted): `pay-desktop-light-nowallet`, `pay-desktop-dark-nowallet`, `focus-ring-email` (clip), `pay-mobile-320`, `pay-mobile-390`, `status-empty`, `claim-empty`, `pay-wrong-network`, `pay-approve-step`, `pay-pay-step`, `pay-email-error`, `pay-received`, `status-paid`, `claim-paid`, `pay-rejected`.

Measured contrast (Chromium computed styles, WCAG 2 ratio): light — muted paragraph and footer label 5.06 (`#666c75` on `#f8fafd`), primary button 5.33 (white on `#0065e0`), every other sampled pair higher; dark — all between 6.5 and 12.3 (e.g. primary button 7.96, hint 6.55). Values are as printed by the script's WCAG 2 computation over Chromium computed colors.

## 5. Not tested / limitations

- No real approval or payment was broadcast; wallet writes and receipts were mocked. Real MetaMask/other-wallet behavior (prompts, EIP-6963 discovery of multiple wallets, `wallet_addEthereumChain` UI) is untested on a live wallet.
- A reverted on-chain payment, RPC outage during confirmation, and the operator API paths (`VITE_OPERATOR_API_URL` unset here) were exercised only by unit tests or source review.
- The public RPC's 50,000-block `eth_getLogs` limit means the app does not scan `PaymentReceived` events; it relies on `receipts(payer, orderId)` reads plus local records and manual lookup.
- Screen readers, native browser zoom, RTL, forced-colors and physical devices were not used. Playwright's mobile emulation is not a device test.
- Open Graph image and absolute social URLs are pending the live domain.
- The publication checks (CID, named entrypoint, asset hashes, RPC chain id and code) run after submission and are not claimed here.

## 6. Completion

**Complete for the stated scope**, with the limitations above. Build, typecheck, unit tests, manifest verification and rendered interaction checks all pass on the final source and export; `dist/` and `dist/imd-deployment.json` were regenerated after the last source change.
