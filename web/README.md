# Get a spend card — frontend

Static single-page app for the IdentityMD spend-card flow on **Sepolia (chain id 11155111)**. A visitor picks one to three Claude-month packs, enters the email that should receive the card, connects a browser wallet, approves the exact IMD quote, and pays. The wallet only ever approves and pays IMD; card delivery and the 15-minute refund are operator obligations. The status page reads receipts live from the contract and the claim page explains delivery.

Stack: Vite 8, React 19, TypeScript 7, wagmi 3, viem 2, TanStack Query. The export in `../dist/` is plain files with a relative base and hash routing, so it works from an IPFS gateway subpath or an ENS name without server rewrites.

## Layout

| Path | Purpose |
| --- | --- |
| `src/config.ts` | The only place addresses, chain id, ABIs, RPC URLs and wallet-add parameters enter the app. It fetches `./imd-deployment.json` at runtime, loads and hash-verifies each referenced ABI, and builds the wagmi config. |
| `src/lib/` | Pure logic: amount/USD formatting, error translation, local order records, chain switch/add flow, optional operator API. |
| `src/hooks/` | Contract reads (facts, quote, balance/allowance, receipts), wallet state, hash routing. |
| `src/pages/` | `PayPage` (pack picker, email, connect/switch/approve/pay), `StatusPage` (receipts, countdown, lookup), `ClaimPage`. |
| `src/components/` | Header with Sepolia badge and wallet chip, footer with contract facts and explorer links, notices, address chips. |
| `deployment/handoff.json`, `deployment/network.json` | Build inputs copied from the workflow handoff (`.imd/reads/deployment.json` and `network.json`). The app never reads these directly. |
| `scripts/prepare-config.mjs` | Verifies `../docs/abi/<Contract>.json` against the handoff `abiHash` (keccak of key-sorted compact JSON) and stages `public/abi/` plus a development `public/imd-deployment.json`. |
| `scripts/write-manifest.mjs` | After `vite build`, writes `../dist/imd-deployment.json` with every exported file's SHA-256 and the network block copied unchanged. `--check` validates the committed manifest against `../dist/`. |
| `test/` | Vitest unit tests for formatting, error mapping, order records, chain switching and the manifest builder. |

## Configuration

Runtime configuration is `dist/imd-deployment.json` (schema version 1): `launchId`, `chainId`, `sourceCommit`, `attestationHash`, `contracts[]` (`name`, `address`, `abiHash`, `abiPath`), `assets[]` (`path`, `sha256`), `network` and `walletAddChain`. The app requires contracts named `ImdCardPayment` and `LaunchToken`, refuses to start if an ABI's canonical keccak differs from its `abiHash`, and reads through `network.rpcUrls` (with the wallet provider as last fallback). There are no private credentials anywhere in the bundle.

Optional build-time variables (public values only, set in `web/.env` or the environment):

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_OPERATOR_API_URL` | empty | Base URL of the operator service. When set, the app POSTs order intake to `/orders` before paying, reads `/orders/{chainId}/{contract}/{payer}/{orderId}` on the status page, and POSTs `/orders/…/claim` with the email on the claim page. When empty, orders stay in the browser and the claim page explains email delivery. |

WalletConnect is not bundled; the app offers injected (EIP-6963 and `window.ethereum`) wallets. To add WalletConnect, add the `walletConnect` connector from `wagmi/connectors` in `src/config.ts` with a public project id.

Wrong-network handling: the app calls `wallet_switchEthereumChain`; on error 4902 (or an "unrecognized chain" message) it calls `wallet_addEthereumChain` with the manifest's `walletAddChain` block, then switches again (`src/lib/wallet.ts`).

Swaps are intentionally absent: the approved workflow limits wallet actions to approving and paying IMD and forbids naming the DEX in product copy. The `network.uniswapV4` addresses are still carried unchanged in the manifest.

## Install, develop, build

```sh
cd web
npm ci                # install dependencies (node_modules is not committed)
npm run dev           # stages ABIs + dev manifest, then Vite dev server
npm run typecheck     # tsc --noEmit
npm test              # vitest unit tests
npm run build         # prepare-config → typecheck → vite build → write ../dist/imd-deployment.json
npm run verify-manifest   # confirm dist/imd-deployment.json matches the current dist/ byte for byte
npm run preview       # serve the built export locally
```

Rebuild after any source change and commit `dist/` together with the source; the manifest lists every exported file's hash, so a stale export fails `verify-manifest`.

To preview under a subpath (as on a gateway), serve the repository root and open `/dist/#/`; all asset and configuration URLs are relative.

## Validation

`docs/validation.md` records the build, typecheck, unit-test and rendered browser checks (mocked wallet and mocked write RPC calls; live Sepolia reads), the Better Interface review with findings and fixes, and the checks that were not performed. No real transaction was broadcast. `docs/DESIGN.md` documents the implemented design system.
