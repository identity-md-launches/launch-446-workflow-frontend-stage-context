// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {ImdCardPayment} from "../src/ImdCardPayment.sol";

contract PaymentHandler is Test {
    LaunchToken public immutable token;
    ImdCardPayment public immutable payment;
    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xDAD)];
    uint256 public totalPaid;
    uint256 public totalDonated;
    uint256 public nonce;

    constructor(LaunchToken token_, ImdCardPayment payment_) {
        token = token_;
        payment = payment_;
    }

    function pay(uint256 actorSeed, uint8 packSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint8 packs = uint8(bound(packSeed, 1, 3));
        uint256 amount = payment.quote(packs);
        if (token.balanceOf(actor) < amount) return;
        bytes32 order = bytes32(++nonce);
        vm.startPrank(actor);
        token.approve(address(payment), amount);
        assertEq(payment.pay(packs, order, block.timestamp), amount);
        vm.stopPrank();
        totalPaid += amount;
        (uint256 recorded, uint256 paidAt, uint8 recordedPacks) = payment.receipts(actor, order);
        assertEq(recorded, amount);
        assertEq(paidAt, block.timestamp);
        assertEq(recordedPacks, packs);
    }

    function donate(uint256 actorSeed, uint256 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(rawAmount, 0, token.balanceOf(actor));
        vm.prank(actor);
        token.transfer(address(payment), amount);
        totalDonated += amount;
    }

    function transferBetweenPayers(uint256 fromSeed, uint256 toSeed, uint256 rawAmount) external {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 amount = bound(rawAmount, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, amount);
    }
}

contract PaymentInvariantTest is Test {
    LaunchToken internal token;
    ImdCardPayment internal payment;
    PaymentHandler internal handler;
    address internal constant RECIPIENT = address(0xCAFE);

    function setUp() public {
        vm.chainId(11155111);
        token = new LaunchToken();
        payment = new ImdCardPayment(address(token), RECIPIENT, 20e8, 1e6);
        handler = new PaymentHandler(token, payment);
        for (uint256 i; i < 3; ++i) {
            token.transfer(handler.actors(i), 1e24);
        }
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = PaymentHandler.pay.selector;
        selectors[1] = PaymentHandler.donate.selector;
        selectors[2] = PaymentHandler.transferBetweenPayers.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_conservationAndNoRetainedPayments() public view {
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(RECIPIENT), handler.totalPaid());
        assertEq(token.balanceOf(address(payment)), handler.totalDonated());
        uint256 actorBalances;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            actorBalances += token.balanceOf(actor);
            assertEq(token.allowance(actor, address(payment)), 0);
        }
        assertEq(actorBalances + handler.totalPaid() + handler.totalDonated(), 3e24);
        assertEq(token.balanceOf(address(this)), 1e27 - 3e24);
    }
}
