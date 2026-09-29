// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {ImdCardPayment} from "src/ImdCardPayment.sol";

/// @dev Ghost balances start from the distribution, and change only by requested actions.
/// They are never refreshed from the token or from payment receipts.
contract PaymentLifecycleHandler is Test {
    uint256 public constant PACK = 2160 ether;
    uint256 public constant INITIAL = 1e24;
    LaunchToken public immutable token;
    ImdCardPayment public immutable payment;
    address[4] public actors = [address(0xA11CE), address(0xB0B), address(0xDAD), address(0xCAFE)];
    uint256[4] public balances;
    uint256[4] public approvals;
    uint256 public donated;
    uint256 public successfulPayments;
    uint256 public rejectedPayments;
    uint256 private nonce;

    struct ExpectedReceipt {
        uint256 actor;
        bytes32 order;
        uint256 amount;
        uint256 paidAt;
        uint8 packs;
    }

    ExpectedReceipt[] private history;

    constructor(LaunchToken token_, ImdCardPayment payment_) {
        token = token_;
        payment = payment_;
        for (uint256 i; i < 4; ++i) {
            balances[i] = INITIAL;
        }
    }

    function pay(uint256 actorSeed, uint8 packSeed, bool infinite) external {
        uint256 actor = actorSeed % 4;
        uint8 packs = uint8(bound(packSeed, 1, 3));
        _approve(actor, infinite ? type(uint256).max : PACK * packs);
        _attemptPay(actor, packs, bytes32(++nonce));
    }

    function approve(uint256 actorSeed, uint256 amountSeed, uint8 mode) external {
        uint256 amount = mode % 3 == 0 ? 0 : mode % 3 == 1 ? type(uint256).max : bound(amountSeed, 1, PACK * 9);
        _approve(actorSeed % 4, amount);
    }

    function payUsingExistingApproval(uint256 actorSeed, uint8 packSeed) external {
        _attemptPay(actorSeed % 4, uint8(bound(packSeed, 1, 3)), bytes32(++nonce));
    }

    function donate(uint256 actorSeed, uint256 amountSeed) external {
        uint256 actor = actorSeed % 4;
        uint256 cap = balances[actor] < 3 * PACK ? balances[actor] : 3 * PACK;
        uint256 amount = bound(amountSeed, 0, cap);
        vm.prank(actors[actor]);
        assertTrue(token.transfer(address(payment), amount));
        balances[actor] -= amount;
        donated += amount;
    }

    // Includes operator spending/refunding proceeds, self transfers, zero and whole balances.
    // A direct operator transfer models token movement, not backend refund fulfillment.
    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        uint256 from = fromSeed % 4;
        uint256 to = toSeed % 4;
        uint256 amount = bound(amountSeed, 0, balances[from]);
        vm.prank(actors[from]);
        assertTrue(token.transfer(actors[to], amount));
        balances[from] -= amount;
        balances[to] += amount;
    }

    function advanceTime(uint32 timeSeed) external {
        vm.warp(vm.getBlockTimestamp() + bound(timeSeed, 0, 30 days));
    }

    function replay(uint256 receiptSeed) external {
        // Seeded with four successful receipts in setUp, so this never skips.
        ExpectedReceipt memory receipt = history[receiptSeed % history.length];
        if (receipt.amount == 0) receipt = history[receiptSeed % 4];
        _reject(
            receipt.actor,
            3,
            receipt.order,
            block.timestamp,
            abi.encodeWithSelector(ImdCardPayment.DuplicatePayment.selector)
        );
    }

    function invalidThenRetry(uint256 actorSeed, uint8 packSeed, uint8 failureSeed) external {
        uint256 actor = actorSeed % 4;
        uint8 packs = uint8(bound(packSeed, 1, 3));
        bytes32 order = bytes32(++nonce);
        uint8 failure = failureSeed % 5;
        _approve(actor, PACK * packs);
        if (failure == 0) {
            _reject(actor, 0, order, block.timestamp, abi.encodeWithSelector(ImdCardPayment.InvalidPackCount.selector));
        } else if (failure == 1) {
            _reject(
                actor, 255, order, block.timestamp, abi.encodeWithSelector(ImdCardPayment.InvalidPackCount.selector)
            );
        } else if (failure == 2) {
            _reject(
                actor, packs, order, block.timestamp - 1, abi.encodeWithSelector(ImdCardPayment.PaymentExpired.selector)
            );
        } else if (failure == 3) {
            _reject(
                actor,
                packs,
                bytes32(0),
                block.timestamp,
                abi.encodeWithSelector(ImdCardPayment.InvalidOrderId.selector)
            );
            _assertEmpty(actor, bytes32(0));
        } else {
            vm.chainId(1);
            _reject(actor, packs, order, block.timestamp, abi.encodeWithSelector(ImdCardPayment.WrongChain.selector));
            vm.chainId(11155111);
        }
        _assertEmpty(actor, order);
        // Check rollback BEFORE the retry changes balances/allowances.
        assertAccounting();
        _attemptPay(actor, packs, order);
    }

    function assertAccounting() public view {
        uint256 sum = token.balanceOf(address(payment));
        assertEq(sum, donated, "a payment consumed donations or retained proceeds");
        for (uint256 i; i < 4; ++i) {
            assertEq(token.balanceOf(actors[i]), balances[i], "actor balance differs from ledger");
            assertEq(token.allowance(actors[i], address(payment)), approvals[i], "approval differs from ledger");
            sum += token.balanceOf(actors[i]);
        }
        assertEq(sum, 4 * INITIAL, "payment or transfer changed circulating supply");
        assertEq(token.totalSupply(), 1e27);
    }

    function assertReceiptHistory() external view {
        for (uint256 i; i < history.length; ++i) {
            ExpectedReceipt memory expected = history[i];
            (uint256 amount, uint256 paidAt, uint8 packs) = payment.receipts(actors[expected.actor], expected.order);
            assertEq(amount, expected.amount, "old receipt amount changed");
            assertEq(paidAt, expected.paidAt, "old receipt timestamp changed");
            assertEq(packs, expected.packs, "old receipt packs changed");
        }
    }

    function _approve(uint256 actor, uint256 amount) private {
        vm.prank(actors[actor]);
        assertTrue(token.approve(address(payment), amount));
        approvals[actor] = amount;
    }

    function _attemptPay(uint256 actor, uint8 packs, bytes32 order) private {
        uint256 amount = PACK * packs; // Independent quote from the fixed $20 / $0.01 fixture.
        bytes memory error;
        if (approvals[actor] < amount) {
            error = abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(payment), approvals[actor], amount
            );
        } else if (balances[actor] < amount) {
            error = abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, actors[actor], balances[actor], amount
            );
        }
        if (error.length != 0) {
            _reject(actor, packs, order, block.timestamp, error);
            _assertEmpty(actor, order);
            history.push(ExpectedReceipt(actor, order, 0, 0, 0));
            return;
        }
        vm.prank(actors[actor]);
        assertEq(payment.pay(packs, order, block.timestamp), amount);
        balances[actor] -= amount;
        balances[3] += amount;
        if (approvals[actor] != type(uint256).max) approvals[actor] -= amount;
        history.push(ExpectedReceipt(actor, order, amount, block.timestamp, packs));
        ++successfulPayments;
    }

    function _reject(uint256 actor, uint8 packs, bytes32 order, uint256 deadline, bytes memory expected) private {
        vm.prank(actors[actor]);
        (bool ok, bytes memory result) = address(payment).call(abi.encodeCall(payment.pay, (packs, order, deadline)));
        assertFalse(ok, "invalid payment succeeded");
        assertEq(result, expected, "unexpected failure path");
        ++rejectedPayments;
    }

    function _assertEmpty(uint256 actor, bytes32 order) private view {
        (uint256 amount, uint256 paidAt, uint8 packs) = payment.receipts(actors[actor], order);
        assertEq(amount, 0);
        assertEq(paidAt, 0);
        assertEq(packs, 0);
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract PaymentLifecycleInvariantTest is Test {
    LaunchToken private token;
    ImdCardPayment private payment;
    PaymentLifecycleHandler private handler;

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(1_000_000);
        token = new LaunchToken();
        payment = new ImdCardPayment(address(token), address(0xCAFE), 20e8, 1e6);
        handler = new PaymentLifecycleHandler(token, payment);
        for (uint256 i; i < 4; ++i) {
            token.transfer(handler.actors(i), 1e24);
        }
        for (uint256 i; i < 4; ++i) {
            handler.pay(i, uint8(i % 3 + 1), i % 2 == 0);
        }

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.pay.selector;
        selectors[1] = handler.approve.selector;
        selectors[2] = handler.payUsingExistingApproval.selector;
        selectors[3] = handler.donate.selector;
        selectors[4] = handler.transfer.selector;
        selectors[5] = handler.advanceTime.selector;
        selectors[6] = handler.replay.selector;
        selectors[7] = handler.invalidThenRetry.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_balancesAllowancesAndSupplyMatchIndependentLedger() public view {
        handler.assertAccounting();
        assertEq(token.balanceOf(address(this)), 1e27 - 4e24);
        assertEq(token.balanceOf(address(handler)), 0);
        assertEq(token.balanceOf(address(0)), 0);
    }

    function invariant_receiptsNeverChangeAfterLaterActivity() public view {
        handler.assertReceiptHistory();
    }

    function test_handlersExerciseFailuresRecoveryAndOperatorActivity() public {
        handler.approve(0, 0, 0);
        handler.payUsingExistingApproval(0, 1);
        handler.donate(1, 1);
        handler.advanceTime(901);
        handler.replay(0);
        for (uint8 i; i < 5; ++i) {
            handler.invalidThenRetry(i, 3, i);
        }
        handler.transfer(3, 0, handler.balances(3));
        handler.pay(3, 1, false); // Empty operator balance: failure must preserve the order and approval.
        handler.transfer(0, 3, 3 * 2160 ether);
        handler.pay(3, 3, true);
        invariant_balancesAllowancesAndSupplyMatchIndependentLedger();
        invariant_receiptsNeverChangeAfterLaterActivity();
        assertGt(handler.successfulPayments(), 4);
        assertGe(handler.rejectedPayments(), 8);
    }
}
