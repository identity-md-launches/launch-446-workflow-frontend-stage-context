// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Sepolia payment intake for "Get a spend card".
/// @dev No custody after a successful payment: IMD is received and forwarded atomically.
/// Card delivery and refunds are obligations of the off-chain operator, not enforced here.
contract ImdCardPayment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 11155111;
    uint8 public constant MIN_PACKS = 1;
    uint8 public constant MAX_PACKS = 3;
    uint256 public constant REFUND_DELAY = 15 minutes;
    uint256 public constant FEE_BPS = 0;
    uint256 private constant BUFFERED_TOKEN_UNIT = 108 * 10 ** 16;

    IERC20 public immutable imd;
    address public immutable settlementRecipient;
    uint256 public immutable claudeProUsdE8;
    uint256 public immutable imdMidUsdE8;
    uint256 public immutable packPrice;
    uint256 public immutable floatTargetUsdE8;

    struct Receipt {
        uint256 amount;
        uint256 paidAt;
        uint8 packs;
    }

    /// @notice Order references are unique per payer, not globally; another wallet cannot reserve yours.
    mapping(address payer => mapping(bytes32 orderId => Receipt receipt)) public receipts;

    event PaymentReceived(
        address indexed payer, bytes32 indexed orderId, uint8 packs, uint256 amount, uint256 refundDueAt
    );

    error WrongChain();
    error InvalidToken();
    error InvalidRecipient();
    error InvalidPrice();
    error InvalidPackCount();
    error InvalidOrderId();
    error PaymentExpired();
    error DuplicatePayment();
    error InexactTransfer();

    /// @param token_ LaunchToken address ($token in the manifest), with exactly 18 decimals.
    /// @param recipient_ Immutable operator settlement wallet (explicit policy-approved address).
    /// @param packUsdE8_ Mock or reviewed Claude Pro USD price, scaled by 1e8.
    /// @param midUsdE8_ Mock or reviewed USD per IMD midpoint, scaled by 1e8.
    constructor(address token_, address recipient_, uint256 packUsdE8_, uint256 midUsdE8_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (token_.code.length == 0) revert InvalidToken();
        if (IERC20Metadata(token_).decimals() != 18) revert InvalidToken();
        if (recipient_ == address(0) || recipient_ == address(this) || recipient_ == token_) {
            revert InvalidRecipient();
        }
        if (packUsdE8_ == 0 || midUsdE8_ == 0 || packUsdE8_ > type(uint256).max / MAX_PACKS) {
            revert InvalidPrice();
        }

        // Round UP to whole IMD first, then add exactly 8%, represented in minor units.
        uint256 wholeTokens = packUsdE8_ / midUsdE8_;
        if (packUsdE8_ % midUsdE8_ != 0) ++wholeTokens;
        if (wholeTokens > type(uint256).max / (BUFFERED_TOKEN_UNIT * MAX_PACKS)) revert InvalidPrice();

        imd = IERC20(token_);
        settlementRecipient = recipient_;
        claudeProUsdE8 = packUsdE8_;
        imdMidUsdE8 = midUsdE8_;
        // Intentional: the specified formula rounds to whole tokens before applying the buffer.
        // forge-lint: disable-next-line(divide-before-multiply)
        packPrice = wholeTokens * BUFFERED_TOKEN_UNIT;
        floatTargetUsdE8 = packUsdE8_ * MAX_PACKS;
    }

    /// @return amount Exact IMD minor units to approve and pay for 1–3 packs. No separate fee.
    function quote(uint8 packs) public view returns (uint256 amount) {
        if (packs < MIN_PACKS || packs > MAX_PACKS) revert InvalidPackCount();
        return packPrice * packs;
    }

    /// @notice Pay from your own wallet using an opaque order reference; never put email/card data here.
    /// @dev The backend must treat (chain, contract, payer, orderId) as the idempotency key.
    /// The caller's deadline is inclusive. refundDueAt is an off-chain service deadline only.
    function pay(uint8 packs, bytes32 orderId, uint256 deadline) external nonReentrant returns (uint256 amount) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        // A coarse transaction expiry, not a source of randomness or a price input.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert PaymentExpired();
        if (orderId == bytes32(0)) revert InvalidOrderId();
        if (receipts[msg.sender][orderId].amount != 0) revert DuplicatePayment();
        amount = quote(packs);
        receipts[msg.sender][orderId] = Receipt(amount, block.timestamp, packs);

        uint256 intakeBefore = imd.balanceOf(address(this));
        imd.safeTransferFrom(msg.sender, address(this), amount);
        // Compare deltas against a fresh snapshot; existing donations cannot block payments.
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (imd.balanceOf(address(this)) != intakeBefore + amount) revert InexactTransfer();

        uint256 recipientBefore = imd.balanceOf(settlementRecipient);
        imd.safeTransfer(settlementRecipient, amount);
        // Exact deltas deliberately reject tokens that tax, rebase, or pretend to transfer.
        // forge-lint: disable-start(incorrect-strict-equality)
        if (
            imd.balanceOf(address(this)) != intakeBefore
                || imd.balanceOf(settlementRecipient) != recipientBefore + amount
        ) revert InexactTransfer();
        // forge-lint: disable-end(incorrect-strict-equality)

        emit PaymentReceived(msg.sender, orderId, packs, amount, block.timestamp + REFUND_DELAY);
    }
}
