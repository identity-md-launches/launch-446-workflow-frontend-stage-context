# Contract ABI handoff

`abi/LaunchToken.json` and `abi/ImdCardPayment.json` contain the compiler-produced JSON ABI arrays, including constructor inputs, events, custom errors and getters. They are suitable for standard Ethereum client libraries. All IMD amounts are integers in 18-decimal minor units; handle them as big integers, never floating-point JavaScript numbers.

Regenerate after a source change:

```sh
forge build
forge inspect src/LaunchToken.sol:LaunchToken abi --json > docs/abi/LaunchToken.json
forge inspect src/ImdCardPayment.sol:ImdCardPayment abi --json > docs/abi/ImdCardPayment.json
```

## LaunchToken

No constructor inputs. Standard ERC-20 `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `approve`, `transfer`, `transferFrom`, `Transfer` and `Approval`. Approve the application contract for the exact `quote(packs)` before paying. `approve` overwrites the previous allowance; account for pending approval transactions when changing an allowance. There is no permit, mint, ownership, burn, pause or upgrade API.

## ImdCardPayment

| Method | Meaning |
| --- | --- |
| `quote(uint8 packs) → uint256` | Exact price for 1–3 packs; does not read an oracle |
| `pay(uint8 packs, bytes32 orderId, uint256 deadline) → uint256` | Nonpayable; pulls from the caller, forwards and records atomically; returns amount paid |
| `receipts(address payer, bytes32 orderId) → (uint256 amount, uint256 paidAt, uint8 packs)` | Immutable accepted payment; all zeros mean no payment; no delivery/refund status |
| `imd() → address` | Immutable token address |
| `settlementRecipient() → address` | Immutable beneficiary; not a contract admin |
| `claudeProUsdE8()`, `imdMidUsdE8()` | Immutable quoted USD inputs, each scaled by `10^8` |
| `packPrice() → uint256` | Per-pack buffered price in IMD minor units |
| `floatTargetUsdE8() → uint256` | Informational off-chain float target in USD scaled by `10^8` |
| `CHAIN_ID()`, `MIN_PACKS()`, `MAX_PACKS()`, `REFUND_DELAY()`, `FEE_BPS()` | `11155111`, `1`, `3`, `900`, `0` respectively |

```solidity
event PaymentReceived(
    address indexed payer,
    bytes32 indexed orderId,
    uint8 packs,
    uint256 amount,
    uint256 refundDueAt
);
```

The event's first two fields are indexed topics; the remaining fields are ABI-encoded data. The backend must filter by the exact application address and chain, verify successful receipt/confirmation, and key orders by payer and order reference as well as deployment. The deadline is informational for the off-chain refund service. A receipt remains unchanged after an operator refund.

Application validation errors are `WrongChain`, `InvalidToken`, `InvalidRecipient`, `InvalidPrice`, `InvalidPackCount`, `InvalidOrderId`, `PaymentExpired`, `DuplicatePayment`, and `InexactTransfer`. The ABI also includes inherited/library errors. Token failures can bubble ERC-20 errors such as insufficient allowance/balance; callback attempts can return `ReentrancyGuardReentrantCall`. All revert paths undo the receipt and both transfer legs. Reverted transactions consume gas.

There are no payable functions or receive/fallback handlers. Constructors and application bytecode require no linked library deployment, initialization transaction, privileged factory callback, dynamic constructor argument, or delegatecall.
