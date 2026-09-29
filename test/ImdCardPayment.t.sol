// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {ImdCardPayment} from "../src/ImdCardPayment.sol";
import {AdversarialImd, SixDecimalImd, NoReturnImd} from "./mocks/AdversarialImd.sol";

contract ImdCardPaymentTest is Test {
    LaunchToken internal token;
    ImdCardPayment internal payment;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal recipient = address(0xCAFE);
    bytes32 internal constant ORDER = keccak256("opaque random order reference");
    uint256 internal constant PACK = 2160 ether;

    event PaymentReceived(
        address indexed payer, bytes32 indexed orderId, uint8 packs, uint256 amount, uint256 refundDueAt
    );

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(1_000_000);
        token = new LaunchToken();
        payment = new ImdCardPayment(address(token), recipient, 20e8, 1e6);
        token.transfer(alice, PACK * 10);
        token.transfer(bob, PACK * 10);
    }

    function test_constructorConfigurationAndQuote() public view {
        assertEq(address(payment.imd()), address(token));
        assertEq(payment.settlementRecipient(), recipient);
        assertEq(payment.claudeProUsdE8(), 20e8);
        assertEq(payment.imdMidUsdE8(), 1e6);
        assertEq(payment.packPrice(), PACK);
        assertEq(payment.floatTargetUsdE8(), 60e8);
        assertEq(payment.quote(1), PACK);
        assertEq(payment.quote(3), PACK * 3);
        assertEq(payment.REFUND_DELAY(), 900);
        assertEq(payment.FEE_BPS(), 0);
    }

    function test_roundsWholeTokensUpBeforeAddingBuffer() public {
        ImdCardPayment rounded = new ImdCardPayment(address(token), recipient, 20e8, 3e8);
        assertEq(rounded.packPrice(), 7.56 ether);
        ImdCardPayment subToken = new ImdCardPayment(address(token), recipient, 1, 2);
        assertEq(subToken.packPrice(), 1.08 ether);
    }

    function testFuzz_priceFormula(uint64 usd, uint64 mid) public {
        usd = uint64(bound(usd, 1, type(uint64).max));
        mid = uint64(bound(mid, 1, type(uint64).max));
        ImdCardPayment quoted = new ImdCardPayment(address(token), recipient, usd, mid);
        uint256 wholeTokens = (uint256(usd) + uint256(mid) - 1) / uint256(mid);
        assertEq(quoted.packPrice(), wholeTokens * 108 * 1e16);
        assertEq(quoted.quote(3), wholeTokens * 324 * 1e16);
        assertEq(quoted.floatTargetUsdE8(), uint256(usd) * 3);
    }

    function test_payEmitsReceiptAndForwardsExactly() public {
        vm.prank(alice);
        token.approve(address(payment), PACK * 2);
        vm.expectEmit(true, true, false, true, address(payment));
        emit PaymentReceived(alice, ORDER, 2, PACK * 2, block.timestamp + 900);
        vm.prank(alice);
        uint256 amount = payment.pay(2, ORDER, block.timestamp);
        assertEq(amount, PACK * 2);
        _assertReceipt(payment, alice, ORDER, PACK * 2, block.timestamp, 2);
        assertEq(token.balanceOf(alice), PACK * 8);
        assertEq(token.balanceOf(recipient), PACK * 2);
        assertEq(token.balanceOf(address(payment)), 0);
        assertEq(token.allowance(alice, address(payment)), 0);
        assertEq(token.totalSupply(), 1e27);
    }

    function testFuzz_validPackCountsAndPayers(uint8 rawPacks, address payer) public {
        vm.assume(payer != address(0) && payer != address(this) && payer != address(payment));
        vm.assume(payer != address(token) && payer != recipient && payer != address(vm));
        uint8 packs = uint8(bound(rawPacks, 1, 3));
        uint256 amount = PACK * packs;
        token.transfer(payer, amount);
        uint256 before = token.balanceOf(payer);
        vm.startPrank(payer);
        token.approve(address(payment), amount);
        assertEq(payment.pay(packs, ORDER, block.timestamp), amount);
        vm.stopPrank();
        assertEq(token.balanceOf(payer), before - amount);
        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(address(payment)), 0);
    }

    function test_sameOrderCannotChargeSamePayerTwice() public {
        vm.startPrank(alice);
        token.approve(address(payment), PACK * 2);
        payment.pay(1, ORDER, block.timestamp);
        vm.expectRevert(ImdCardPayment.DuplicatePayment.selector);
        payment.pay(1, ORDER, block.timestamp);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), PACK * 9);
        assertEq(token.balanceOf(recipient), PACK);
        assertEq(token.allowance(alice, address(payment)), PACK);
    }

    function test_frontRunningOrderReferenceCannotBlockAnotherPayer() public {
        vm.startPrank(bob);
        token.approve(address(payment), PACK);
        payment.pay(1, ORDER, block.timestamp);
        vm.stopPrank();
        vm.startPrank(alice);
        token.approve(address(payment), PACK);
        payment.pay(1, ORDER, block.timestamp);
        vm.stopPrank();
        _assertReceipt(payment, alice, ORDER, PACK, block.timestamp, 1);
        _assertReceipt(payment, bob, ORDER, PACK, block.timestamp, 1);
        assertEq(token.balanceOf(recipient), PACK * 2);
    }

    function test_multipleOrdersBySamePayer() public {
        vm.startPrank(alice);
        token.approve(address(payment), PACK * 4);
        payment.pay(1, ORDER, block.timestamp);
        payment.pay(3, bytes32(uint256(2)), block.timestamp);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), PACK * 6);
        assertEq(token.balanceOf(recipient), PACK * 4);
    }

    function test_approvalFromVictimCannotBeUsedByAnotherWallet() public {
        vm.prank(alice);
        token.approve(address(payment), PACK);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(payment), 0, PACK)
        );
        vm.prank(bob);
        payment.pay(1, ORDER, block.timestamp);
        assertEq(token.balanceOf(alice), PACK * 10);
        assertEq(token.allowance(alice, address(payment)), PACK);
    }

    function testFuzz_invalidPackCounts(uint8 packs) public {
        vm.assume(packs == 0 || packs > 3);
        vm.expectRevert(ImdCardPayment.InvalidPackCount.selector);
        payment.quote(packs);
        vm.expectRevert(ImdCardPayment.InvalidPackCount.selector);
        vm.prank(alice);
        payment.pay(packs, ORDER, block.timestamp);
        _assertReceipt(payment, alice, ORDER, 0, 0, 0);
    }

    function test_emptyOrderFails() public {
        vm.expectRevert(ImdCardPayment.InvalidOrderId.selector);
        payment.pay(1, bytes32(0), block.timestamp);
    }

    function test_expiredPaymentFailsWithoutReceipt() public {
        vm.prank(alice);
        token.approve(address(payment), PACK);
        vm.expectRevert(ImdCardPayment.PaymentExpired.selector);
        vm.prank(alice);
        payment.pay(1, ORDER, block.timestamp - 1);
        _assertReceipt(payment, alice, ORDER, 0, 0, 0);
        assertEq(token.balanceOf(alice), PACK * 10);
        assertEq(token.allowance(alice, address(payment)), PACK);
    }

    function test_insufficientAllowanceFailsAndOrderCanBeRetried() public {
        vm.startPrank(alice);
        token.approve(address(payment), PACK - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(payment), PACK - 1, PACK)
        );
        payment.pay(1, ORDER, block.timestamp);
        _assertReceipt(payment, alice, ORDER, 0, 0, 0);
        token.approve(address(payment), PACK);
        payment.pay(1, ORDER, block.timestamp);
        vm.stopPrank();
        assertEq(token.balanceOf(recipient), PACK);
    }

    function test_insufficientBalanceRollsBackAllowanceAndReceipt() public {
        vm.startPrank(alice);
        token.transfer(bob, PACK * 10);
        token.approve(address(payment), PACK);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, PACK));
        payment.pay(1, ORDER, block.timestamp);
        vm.stopPrank();
        _assertReceipt(payment, alice, ORDER, 0, 0, 0);
        assertEq(token.allowance(alice, address(payment)), PACK);
        assertEq(token.balanceOf(recipient), 0);
    }

    function test_directDonationsAreNotReceiptsAndCannotBeSwept() public {
        token.transfer(address(payment), 7 ether);
        vm.startPrank(alice);
        token.approve(address(payment), PACK);
        payment.pay(1, ORDER, block.timestamp);
        vm.stopPrank();
        assertEq(token.balanceOf(address(payment)), 7 ether);
        assertEq(token.balanceOf(recipient), PACK);
    }

    function test_noOwnerWithdrawalOrOnchainRefundAfterDeadline() public {
        uint256 paidAt = vm.getBlockTimestamp();
        vm.startPrank(alice);
        token.approve(address(payment), PACK);
        payment.pay(1, ORDER, paidAt);
        vm.stopPrank();
        vm.warp(paidAt + 900);
        bytes[5] memory calls = [
            abi.encodeWithSignature("withdraw(uint256)", PACK),
            abi.encodeWithSignature("refund(bytes32)", ORDER),
            abi.encodeWithSignature("setRecipient(address)", alice),
            abi.encodeWithSignature("setPrice(uint256)", 1),
            abi.encodeWithSignature("pause()")
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool deployerOk,) = address(payment).call(calls[i]);
            vm.prank(alice);
            (bool userOk,) = address(payment).call(calls[i]);
            vm.prank(recipient);
            (bool recipientOk,) = address(payment).call(calls[i]);
            assertFalse(deployerOk);
            assertFalse(userOk);
            assertFalse(recipientOk);
        }
        assertEq(token.balanceOf(recipient), PACK);
        assertEq(token.balanceOf(alice), PACK * 9);
        // Service refund is an ordinary IMD transfer from the operator, with no app privileges.
        vm.prank(recipient);
        token.transfer(alice, PACK);
        assertEq(token.balanceOf(alice), PACK * 10);
        assertEq(token.balanceOf(recipient), 0);
        _assertReceipt(payment, alice, ORDER, PACK, paidAt, 1);
    }

    function test_rejectsNativeValueAndUnknownCalls() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool emptyOk,) = address(payment).call{value: 1}("");
        assertFalse(emptyOk);
        vm.prank(alice);
        (bool payOk,) = address(payment).call{value: 1}(abi.encodeCall(payment.pay, (1, ORDER, block.timestamp)));
        assertFalse(payOk);
        assertEq(address(payment).balance, 0);
    }

    function test_rejectsWrongChainAtDeploymentAndPayment() public {
        vm.chainId(1);
        vm.expectRevert(ImdCardPayment.WrongChain.selector);
        new ImdCardPayment(address(token), recipient, 20e8, 1e6);
        vm.expectRevert(ImdCardPayment.WrongChain.selector);
        payment.pay(1, ORDER, block.timestamp);
    }

    function test_rejectsInvalidTokenAndRecipient() public {
        vm.expectRevert(ImdCardPayment.InvalidToken.selector);
        new ImdCardPayment(address(0), recipient, 20e8, 1e6);
        vm.expectRevert(ImdCardPayment.InvalidToken.selector);
        new ImdCardPayment(alice, recipient, 20e8, 1e6);
        SixDecimalImd wrongDecimals = new SixDecimalImd();
        vm.expectRevert(ImdCardPayment.InvalidToken.selector);
        new ImdCardPayment(address(wrongDecimals), recipient, 20e8, 1e6);
        vm.expectRevert(ImdCardPayment.InvalidRecipient.selector);
        new ImdCardPayment(address(token), address(0), 20e8, 1e6);
        vm.expectRevert(ImdCardPayment.InvalidRecipient.selector);
        new ImdCardPayment(address(token), address(token), 20e8, 1e6);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(ImdCardPayment.InvalidRecipient.selector);
        new ImdCardPayment(address(token), predicted, 20e8, 1e6);
    }

    function test_rejectsZeroOrOverflowingPrices() public {
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), recipient, 0, 1e6);
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), recipient, 20e8, 0);
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), recipient, type(uint256).max, 1);
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), recipient, type(uint256).max / 3, 1);
    }

    function test_largestRepresentableQuoteDoesNotOverflow() public {
        uint256 maxWhole = type(uint256).max / (324 * 1e16);
        ImdCardPayment large = new ImdCardPayment(address(token), recipient, maxWhole, 1);
        assertEq(large.quote(3), maxWhole * (324 * 1e16));
        vm.expectRevert(ImdCardPayment.InvalidPrice.selector);
        new ImdCardPayment(address(token), recipient, maxWhole + 1, 1);
    }

    function test_allTransferFailuresRevertAtomicallyAndPermitRetry() public {
        for (uint8 i = uint8(AdversarialImd.Mode.FalsePull); i <= uint8(AdversarialImd.Mode.RevertPush); ++i) {
            AdversarialImd bad = new AdversarialImd();
            ImdCardPayment target = new ImdCardPayment(address(bad), recipient, 20e8, 1e6);
            bad.approve(address(target), PACK);
            bad.configure(AdversarialImd.Mode(i), target);
            if (i <= uint8(AdversarialImd.Mode.FalsePush)) {
                vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
            } else if (i == uint8(AdversarialImd.Mode.RevertPush)) {
                vm.expectRevert("push failed");
            } else {
                vm.expectRevert(ImdCardPayment.InexactTransfer.selector);
            }
            target.pay(1, ORDER, block.timestamp);
            _assertReceipt(target, address(this), ORDER, 0, 0, 0);
            assertEq(bad.balanceOf(address(this)), 1e27);
            assertEq(bad.balanceOf(address(target)), 0);
            assertEq(bad.balanceOf(recipient), 0);
            assertEq(bad.allowance(address(this), address(target)), PACK);
            assertEq(bad.totalSupply(), 1e27);
            bad.configure(AdversarialImd.Mode.Normal, target);
            target.pay(1, ORDER, block.timestamp);
            assertEq(bad.balanceOf(recipient), PACK);
        }
    }

    function test_reentryOnBothTransferLegsIsBlocked() public {
        AdversarialImd malicious = new AdversarialImd();
        ImdCardPayment target = new ImdCardPayment(address(malicious), recipient, 20e8, 1e6);
        malicious.approve(address(target), PACK);
        malicious.configure(AdversarialImd.Mode.ReenterCaught, target);
        target.pay(1, ORDER, block.timestamp);
        assertEq(malicious.callbackCount(), 2);
        assertEq(malicious.callbackError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(malicious.balanceOf(recipient), PACK);
        _assertReceipt(target, address(malicious), bytes32(uint256(123)), 0, 0, 0);
        _assertReceipt(target, address(this), ORDER, PACK, block.timestamp, 1);
    }

    function test_bubbledReentryRollsBackPayment() public {
        AdversarialImd malicious = new AdversarialImd();
        ImdCardPayment target = new ImdCardPayment(address(malicious), recipient, 20e8, 1e6);
        malicious.approve(address(target), PACK);
        malicious.configure(AdversarialImd.Mode.ReenterBubbled, target);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        target.pay(1, ORDER, block.timestamp);
        assertEq(malicious.balanceOf(address(this)), 1e27);
        assertEq(malicious.balanceOf(recipient), 0);
        _assertReceipt(target, address(this), ORDER, 0, 0, 0);
    }

    function test_noReturnTokenIsHandledSafely() public {
        NoReturnImd legacy = new NoReturnImd();
        ImdCardPayment target = new ImdCardPayment(address(legacy), recipient, 20e8, 1e6);
        legacy.approve(address(target), PACK);
        target.pay(1, ORDER, block.timestamp);
        assertEq(legacy.balanceOf(address(this)), 1e27 - PACK);
        assertEq(legacy.balanceOf(recipient), PACK);
        assertEq(legacy.balanceOf(address(target)), 0);
    }

    function _assertReceipt(
        ImdCardPayment target,
        address payer,
        bytes32 order,
        uint256 expectedAmount,
        uint256 expectedTime,
        uint8 expectedPacks
    ) internal view {
        (uint256 amount, uint256 paidAt, uint8 packs) = target.receipts(payer, order);
        assertEq(amount, expectedAmount);
        assertEq(paidAt, expectedTime);
        assertEq(packs, expectedPacks);
    }
}
