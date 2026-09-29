# Adversarial contract coverage

These tests supplement the accepted suite without changing contracts or configuration.
They run offline using the already vendored dependencies. No RPC, environment mutation,
FFI, new dependency, or files under `.imd/reads` are needed to run them.

| File | Additional properties |
| --- | --- |
| `PaymentProperties.t.sol` | Whole-IMD rounding boundaries across uint256 inputs; quote invariance under common price scaling; quote monotonicity as IMD price rises; constructor overflow limits including overflow caused by rounding up; inclusive payment expiry and the 900-second event deadline; a one-minor-unit balance shortfall; malformed ABI input; transfer failures with existing donations and recipient funds; reentrancy failure followed by successful retry. |
| `PaymentLifecycleInvariant.t.sol` | Four actors interleave payments, existing approvals, approval replacement/revocation, invalid payments and retries, replays, donations, direct transfers and time jumps. An independent ledger checks every actor's balance and payment allowance, retained donations, and supply. Every recorded successful or failed financial attempt remains consistent with its original receipt after subsequent activity. |
| `LaunchTokenInvariant.t.sol` | Four actors hold the entire supply and interleave approvals, transfers and delegated transfers. Checks fixed supply, each actor's exact balance, allowance isolation, revocation, finite versus infinite approvals, and atomic failure. Includes zero, one minor unit, self transfers, whole balances, the full supply, and insufficient balance/allowance. |

The payment fixture uses the approved mock inputs ($20 per pack and $0.01 per IMD),
so the ledger independently expects 2,160 IMD per pack. Ghost state is updated from
requested operations, never copied back from contract balances or receipts. Invariant
targets explicitly select only the handler actions. Expected contract reverts are checked;
unexpected handler reverts fail the campaign. Successful receipts are seeded so replay
and history checks cannot pass solely because no payments occurred. Deterministic tests
also exercise each handler's failure and recovery paths.

New fuzz properties use 1,000 runs. Each new invariant campaign uses 256 runs at depth
64, set through inline Foundry configuration in the test files.

From the repository root, these commands keep generated artifacts inside scratch space:

```sh
forge build --offline --out test/scratch/out --cache-path test/scratch/cache
forge test --offline --out test/scratch/out --cache-path test/scratch/cache
```

The default `forge test` also discovers these suites. Nothing under `test/scratch/`
is an input dependency of the submitted tests.

## Scope of the evidence

The application forwards payments to the configured operator. Its event deadline and
receipt persistence can be tested here; the tests do not establish that the operator
delivers a card or refunds within 15 minutes. Direct operator transfers in the handler
exercise token accounting only. The workflow's fulfillment, refund scheduling, float
management, frontend and hosting requirements still need their service-level checks.

The application calls only the local token; it has no on-chain swap or price-feed
integration requiring a live fork. Existing token stand-ins cover nonstandard ERC-20
behavior offline. No live deployment, final manifest authorization, policy admission,
or independent launch review is claimed. The supplied protected deployment checks were
read as the baseline definitions; their environment-driven service harness is not copied
into this environment-independent suite.
