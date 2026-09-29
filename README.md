# IdentityMD spend-card contracts

Implemented contract-stage contribution for **Sepolia (11155111) only**. The application accepts IMD for 1–3 Claude-month packs and emits `PaymentReceived`. It has no owner, admin, pause, upgrade, withdrawal, or initialization function.

`LaunchToken` is IdentityMD / IMD, an 18-decimal ERC-20. Its argument-free constructor mints exactly 1,000,000,000 IMD (`10^27` minor units) to its deployer, including when that deployer is ProjectFactory. There is no subsequent mint or burn entry point, fee, blocklist, or privileged role.

`ImdCardPayment` pulls IMD into itself and immediately forwards the exact payment to its immutable `settlementRecipient`. Both transfers and the receipt commit together, or everything reverts. The recipient receives funds but has **no contract administration powers**. No funds move during application construction.

## Pricing and deployment inputs

The initial quote is deliberately a **mock**, not a claim about current subscription or token market prices. Both USD inputs have eight decimal places. The quote is fixed for the lifetime of an instance; no live feed or exchange spot price is used.

```text
P = Claude Pro monthly USD price
M = USD per IMD midpoint, M > 0
wholeIMD = ceil(P / M)
packIMD = wholeIMD × 1.08
packPriceMinor = wholeIMD × 108 × 10^16
paymentMinor = packs × packPriceMinor, packs ∈ {1, 2, 3}
floatTargetUSD = 3 × P
serviceFee = 0%
```

The ceiling applies to **whole IMD before the 8% buffer**. The buffer remains in the amount forwarded to the operator; it is not a separate protocol fee. Because IMD has 18 decimals, the 8% multiplication requires no further rounding. All multiplication bounds are checked at construction.

Mock inputs `P = $20`, `M = $0.01` give **2,160 IMD per pack**, 6,480 IMD for three packs, and **$60 operator float**. Another example: `$20 / $3` rounds to 7 IMD, then becomes 7.56 IMD with the buffer. Float is an off-chain reserve requirement, not a deposit enforced by this contract; concurrent demand and refunds may require more than the minimum target.

Deployment order and parameters for the separate manifest contributor:

| Artifact | Constructor argument | Type | Intended value |
| --- | --- | --- | --- |
| `src/LaunchToken.sol:LaunchToken` | none | — | No arguments; token decimals 18, supply `1000000000000000000000000000` |
| `src/ImdCardPayment.sol:ImdCardPayment` | `token_` | `address` | `$token`, the launch token deployed first |
| same | `recipient_` | `address` | `$owner` **if the policy owner is the intended settlement operator** |
| same | `packUsdE8_` | `uint256` | Mock `2000000000` |
| same | `midUsdE8_` | `uint256` | Mock `1000000` |

The application identifier is `ImdCardPayment`. Constructor argument order is token, recipient, pack USD, token USD midpoint. All constructors are nonpayable and fully configure their instances. The application rejects construction or payment on any chain other than Sepolia. The generic launch token itself has no chain restriction. The compiler is pinned to Solidity 0.8.26, Cancun, optimizer 200 runs, `bytecode_hash = "none"`.

No live operator address or production price was provided. The final manifest and independent review must resolve and inspect the actual settlement beneficiary and quote. `$owner` must be the policy-provided address, never an assumption that the factory's `msg.sender` is a usable operator. If policy ownership and operations differ, services and reviewers must resolve that concrete beneficiary conflict before launch. This contribution writes no `launch.json` and performs no deployment or broadcast. Source publication, attestation, policy/signed-artifact linkage, admission, deployment and frontend startup belong to subsequent services.

## Payment flow

1. On Sepolia, read `quote(packs)` for a count of 1–3. Display the fixed quote and an expiry for submitting the payment.
2. Obtain a random, nonzero 32-byte order reference. Keep email, card information and claim secrets in the backend; the public order reference must not be an email hash or a claim credential.
3. Approve exactly that quote on IMD with the payment contract as spender, then call `pay(packs, orderId, deadline)`. The deadline is inclusive and expressed as Unix seconds. These are the only wallet transaction actions in the product flow.
4. The contract debits `msg.sender`, forwards payment to the immutable recipient, stores `receipts(payer, orderId)`, and emits `PaymentReceived(payer, orderId, packs, amount, refundDueAt)` only after both transfers succeed.
5. The operator indexes the event from the configured chain and application address. It validates amount/packs and associates the reference with the payer before starting off-chain fulfillment.

An order reference can be used only once **per payer**. Another wallet copying it cannot prevent the original payer's payment. Off-chain records must use `(chainId, paymentContract, payer, orderId)` as the idempotency key. A new reference permits another purchase; 3 is a transaction limit, not a per-wallet lifetime limit. Any wallet or contract may pay, including the settlement recipient; a recipient paying itself produces a receipt but no net new operator funds and must not be counted as new external revenue.

Missing/insufficient approval, insufficient balance, expired deadlines, invalid pack counts, empty/duplicate references, false-returning transfers, taxed/no-op transfers and reentrancy all fail atomically. A failed transaction consumes no reference or allowance. Correct legacy tokens returning no data are supported, but deployment must bind the application to the reviewed `LaunchToken`; checking decimals does not establish that an arbitrary token is honest.

## Fulfillment, refunds and custody

**The 15-minute refund is an operator obligation, not an on-chain guarantee.** This is a payment forwarder, not an escrow. There is no on-chain fulfillment oracle, card status, automatic timer, refund method, or user withdrawal. `refundDueAt = payment block timestamp + 900 seconds` is the service deadline. The immutable receipt records a payment, not proof of card delivery or a later refund.

The backend must run a persistent timer starting at the payment's on-chain timestamp. If no card is delivered by that deadline, it must cancel unfinished fulfillment and transfer the **full original IMD amount, including the buffer**, back to the original payer on Sepolia, with no service fee deducted. Gas paid by the user is not included in the IMD refund. An operator must retain/replenish enough IMD to do this even if proceeds have already been swapped; the USD float alone does not ensure IMD refund solvency. An offline, insolvent or dishonest operator can fail this obligation, and the contract cannot compel payment.

Required backend behavior:

- Track accepted events across confirmations and reorgs. Use the payment timestamp for the timer, not when the indexer first notices it. Reconcile after restart and deduplicate log deliveries.
- Perform swap and Bitrefill purchase off-chain, using operator resources. Apply transaction slippage limits and provider idempotency independently of the user's wallet. Sandbox integration is acceptable for this Sepolia workflow.
- Serialize fulfillment and refund transitions for each payment. Once refund is committed, suppress late card delivery or handle provider cancellation/reconciliation so a retry cannot intentionally deliver both outcomes.
- Persist states such as paid, processing, delivered, refund-due and refunded; save the refund transaction hash. Retry failed refund broadcasts safely, and mark refunded only after confirmed transfer. An exact transfer in the token contract does not by itself establish which order was refunded; maintain that association in the service ledger.
- Require payer authentication and private email/claim verification before disclosing card data. A public event or order reference is never sufficient authorization to claim a card.

The frontend/hosting service still owns the pack picker, Sepolia wallet connection, email entry, status and claim-card pages, Sepolia badge, and public IPFS label `imd-bitrefill-card`. Product copy is **“Get a spend card”**; do not surface Uniswap, USDC or Bitrefill names in that flow. User wallet actions are limited to approving/paying IMD. Those services are later workflow deliverables, not implemented or hosted by this contract-stage contribution.

There is no recovery route for IMD sent directly to the application without `pay`, other ERC-20 tokens, or forcibly sent ETH. Direct transfers create no purchase and remain stranded; pre-existing IMD donations do not interfere with legitimate payments. Normal ETH transfers and ETH attached to `pay` revert. The operator cannot pause intake, alter pricing or rotate its recipient on an existing instance. Changing configuration requires a newly reviewed deployment and coordinated frontend/indexer migration, with the old address still technically callable.

## Build and verification

All Solidity dependencies are vendored as ordinary files under `lib/`; no install step, submodule, FFI, filesystem cheatcode permission, RPC, key or environment variable is required. Dependency versions, licenses and archive hashes are in [DEPENDENCIES.md](docs/DEPENDENCIES.md).

```sh
forge build
forge test
forge fmt --check
```

The suite includes token supply/transfers/allowances and missing privileged entry points; constructor and chain restrictions; exact pricing and rounding fuzz tests; 1–3 pack boundaries; expiry; independent and repeated orders; intake/forwarding failures with rollback; callback reentrancy; donated balances; the explicit absence of on-chain refunds; a simulated operator refund; and CREATE2 factory deployment with supply preservation, runtime size and forbidden-opcode scanning. Stateful invariant testing interleaves payments, donations and transfers and checks total supply, fund conservation, operator receipts, retained donations and consumed exact approvals.

The supplied protected checks are an external environment-driven harness. They are not copied into the normal environment-independent suite. Local deployment tests cover their constructor/supply/runtime assertions but do not claim an independent attestation. Independent adversarial review of the accepted contracts and concrete manifest remains a later stage; no Slither or Mythril assessment is claimed.

The generated ABI arrays are [LaunchToken.json](docs/abi/LaunchToken.json) and [ImdCardPayment.json](docs/abi/ImdCardPayment.json). See [ABI.md](docs/ABI.md) for integration details and regeneration commands.
