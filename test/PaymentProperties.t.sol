// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {ImdCardPayment} from "src/ImdCardPayment.sol";
import {AdversarialImd} from "./mocks/AdversarialImd.sol";

/// @dev Additional boundary and rollback properties; no RPC or environment configuration.
/// forge-config: default.fuzz.runs = 1000
contract PaymentPropertiesTest is Test {
    uint256 private constant UNIT = 1.08 ether;
    uint256 private constant PACK = 2160 ether;
    uint256 private constant MAX_USD = type(uint256).max / 3;
    uint256 private constant MAX_WHOLE = type(uint256).max / (3 * UNIT);
    address private constant PAYER = address(0xA11CE);
    address private constant RECIPIENT = address(0xCAFE);
    bytes32 private constant ORDER = keccak256("retryable order");
    LaunchToken private token;
    ImdCardPayment private payment;

    event PaymentReceived(
        address indexed payer, bytes32 indexed orderId, uint8 packs, uint256 amount, uint256 refundDueAt
    );

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(1_000_000);
        token = new LaunchToken();
        payment = _quoted(20e8, 1e6);
    }

    // Construct prices around known multiples instead of copying the implementation's ceiling.
    function testFuzz_roundingChangesOnlyAboveExactMultiple(uint256 wholeSeed, uint256 midSeed) public {
        uint256 whole = bound(wholeSeed, 1, MAX_WHOLE - 1);
        uint256 mid = bound(midSeed, 2, (MAX_USD - 1) / whole);
        uint256 exact = whole * mid;
        ImdCardPayment below = _quoted(exact - 1, mid);
        ImdCardPayment at = _quoted(exact, mid);
        ImdCardPayment above = _quoted(exact + 1, mid);
        assertEq(below.quote(1), whole * UNIT);
        assertEq(at.quote(3), whole * UNIT * 3);
        assertEq(above.quote(1) - at.quote(1), UNIT);
        assertEq(above.floatTargetUsdE8() - below.floatTargetUsdE8(), 6);
    }

    function testFuzz_commonPriceScalePreservesQuote(uint128 usdSeed, uint128 midSeed, uint256 scaleSeed) public {
        uint256 usd = bound(usdSeed, 1, type(uint128).max);
        uint256 mid = bound(midSeed, 1, type(uint128).max);
        uint256 largest = usd > mid ? usd : mid;
        uint256 scale = bound(scaleSeed, 1, MAX_USD / largest);
        ImdCardPayment original = _quoted(usd, mid);
        ImdCardPayment scaled = _quoted(usd * scale, mid * scale);
        assertEq(scaled.quote(3), original.quote(3));
        assertEq(scaled.floatTargetUsdE8(), original.floatTargetUsdE8() * scale);
    }

    function testFuzz_moreExpensiveImdCannotIncreasePackQuote(uint256 usdSeed, uint256 midSeed, uint256 deltaSeed)
        public
    {
        uint256 usd = bound(usdSeed, 1, MAX_WHOLE);
        uint256 mid = bound(midSeed, 1, type(uint256).max);
        uint256 delta = bound(deltaSeed, 0, type(uint256).max - mid);
        assertLe(_quoted(usd, mid + delta).quote(3), _quoted(usd, mid).quote(3));
    }

    function test_fullWidthPriceLimitsAndCeilingOverflow() public {
        assertEq(_quoted(1, type(uint256).max).quote(1), UNIT);
        assertEq(_quoted(MAX_USD, MAX_USD).floatTargetUsdE8(), MAX_USD * 3);
        assertEq(_quoted(MAX_USD, MAX_USD).quote(3), 3 * UNIT);
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), RECIPIENT, MAX_USD + 1, type(uint256).max);

        assertEq(_quoted(MAX_WHOLE * 3, 3).quote(3), MAX_WHOLE * UNIT * 3);
        // The truncated quotient still fits; it is rounding UP that makes this invalid.
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), RECIPIENT, MAX_WHOLE * 3 + 1, 3);
    }

    function test_oneMinorUnitShortBalanceRollsBackThenRetryUsesSameOrder() public {
        token.transfer(PAYER, PACK - 1);
        vm.prank(PAYER);
        token.approve(address(payment), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, PAYER, PACK - 1, PACK));
        vm.prank(PAYER);
        payment.pay(1, ORDER, block.timestamp);
        _emptyReceipt(payment, PAYER);
        assertEq(token.balanceOf(PAYER), PACK - 1);
        assertEq(token.balanceOf(RECIPIENT), 0);
        assertEq(token.allowance(PAYER, address(payment)), type(uint256).max);
        token.transfer(PAYER, 1);
        vm.prank(PAYER);
        assertEq(payment.pay(1, ORDER, block.timestamp), PACK);
        assertEq(token.balanceOf(PAYER), 0);
        assertEq(token.balanceOf(RECIPIENT), PACK);
        assertEq(token.allowance(PAYER, address(payment)), type(uint256).max);
    }

    function testFuzz_inclusiveDeadlineAndRefundEvent(uint64 timeSeed, uint8 packSeed) public {
        uint256 paidAt = bound(timeSeed, 1, type(uint64).max);
        uint8 packs = uint8(bound(packSeed, 1, 3));
        uint256 amount = PACK * packs;
        token.transfer(PAYER, amount);
        vm.prank(PAYER);
        token.approve(address(payment), amount);
        vm.warp(paidAt);
        vm.expectRevert(ImdCardPayment.PaymentExpired.selector);
        vm.prank(PAYER);
        payment.pay(packs, ORDER, paidAt - 1);
        _emptyReceipt(payment, PAYER);
        assertEq(token.allowance(PAYER, address(payment)), amount);

        vm.expectEmit(true, true, false, true, address(payment));
        emit PaymentReceived(PAYER, ORDER, packs, amount, paidAt + 15 minutes);
        vm.prank(PAYER);
        assertEq(payment.pay(packs, ORDER, paidAt), amount);
        (uint256 recorded, uint256 timestamp, uint8 count) = payment.receipts(PAYER, ORDER);
        assertEq(recorded, amount);
        assertEq(timestamp, paidAt);
        assertEq(count, packs);
        assertEq(token.balanceOf(RECIPIENT), amount);
    }

    function test_malformedPackWordCannotTruncateIntoValidPurchase() public {
        token.transfer(PAYER, PACK);
        vm.prank(PAYER);
        token.approve(address(payment), PACK);
        // 257 would become one if an implementation incorrectly truncated the ABI word.
        vm.prank(PAYER);
        (bool ok,) =
            address(payment).call(abi.encodeWithSelector(payment.pay.selector, uint256(257), ORDER, block.timestamp));
        assertFalse(ok);
        _emptyReceipt(payment, PAYER);
        assertEq(token.balanceOf(PAYER), PACK);
        assertEq(token.allowance(PAYER, address(payment)), PACK);
        assertEq(token.balanceOf(RECIPIENT), 0);
    }

    function testFuzz_failedTransferPreservesDonationsAllowanceAndRetry(
        uint8 modeSeed,
        uint8 packSeed,
        uint96 donationSeed,
        uint96 recipientSeed,
        bool infinite
    ) public {
        uint256 donation = bound(donationSeed, 1, 1e24);
        uint256 existing = bound(recipientSeed, 1, 1e24);
        uint8 packs = uint8(bound(packSeed, 1, 3));
        uint256 amount = PACK * packs;
        AdversarialImd bad = new AdversarialImd();
        ImdCardPayment target = new ImdCardPayment(address(bad), RECIPIENT, 20e8, 1e6);
        bad.transfer(address(target), donation);
        bad.transfer(RECIPIENT, existing);
        bad.transfer(PAYER, amount);
        uint256 approval = infinite ? type(uint256).max : amount;
        vm.prank(PAYER);
        bad.approve(address(target), approval);
        AdversarialImd.Mode mode = AdversarialImd.Mode(bound(modeSeed, 1, 7));
        bad.configure(mode, target);
        if (mode == AdversarialImd.Mode.FalsePull || mode == AdversarialImd.Mode.FalsePush) {
            vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        } else if (mode == AdversarialImd.Mode.RevertPush) {
            vm.expectRevert("push failed");
        } else {
            vm.expectRevert(ImdCardPayment.InexactTransfer.selector);
        }
        vm.prank(PAYER);
        target.pay(packs, ORDER, block.timestamp);
        _emptyReceipt(target, PAYER);
        assertEq(bad.balanceOf(PAYER), amount);
        assertEq(bad.balanceOf(address(target)), donation);
        assertEq(bad.balanceOf(RECIPIENT), existing);
        assertEq(bad.allowance(PAYER, address(target)), approval);
        assertEq(bad.totalSupply(), 1e27);

        bad.configure(AdversarialImd.Mode.Normal, target);
        vm.prank(PAYER);
        assertEq(target.pay(packs, ORDER, block.timestamp), amount);
        assertEq(bad.balanceOf(PAYER), 0);
        assertEq(bad.balanceOf(address(target)), donation);
        assertEq(bad.balanceOf(RECIPIENT), existing + amount);
        assertEq(bad.allowance(PAYER, address(target)), infinite ? type(uint256).max : 0);
    }

    function test_reentrancyFailureDoesNotLeaveGuardLocked() public {
        AdversarialImd bad = new AdversarialImd();
        ImdCardPayment target = new ImdCardPayment(address(bad), RECIPIENT, 20e8, 1e6);
        bad.approve(address(target), PACK);
        bad.configure(AdversarialImd.Mode.ReenterBubbled, target);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        target.pay(1, ORDER, block.timestamp);
        _emptyReceipt(target, address(this));
        assertEq(bad.allowance(address(this), address(target)), PACK);
        bad.configure(AdversarialImd.Mode.Normal, target);
        assertEq(target.pay(1, ORDER, block.timestamp), PACK);
        assertEq(bad.balanceOf(RECIPIENT), PACK);
    }

    function _quoted(uint256 usd, uint256 mid) private returns (ImdCardPayment) {
        return new ImdCardPayment(address(token), RECIPIENT, usd, mid);
    }

    function _emptyReceipt(ImdCardPayment target, address payer) private view {
        (uint256 amount, uint256 paidAt, uint8 packs) = target.receipts(payer, ORDER);
        assertEq(amount, 0);
        assertEq(paidAt, 0);
        assertEq(packs, 0);
    }
}
