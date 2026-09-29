// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    LaunchToken internal token;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new LaunchToken();
    }

    function test_metadataAndExactSupply() public view {
        assertEq(token.name(), "IdentityMD");
        assertEq(token.symbol(), "IMD");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
    }

    function testFuzz_transferConservesSupply(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 0, 1e27);
        assertTrue(token.transfer(alice, amount));
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(address(this)), 1e27 - amount);
        assertEq(token.totalSupply(), 1e27);
    }

    function test_transferFromUsesAllowance() public {
        token.transfer(alice, 100 ether);
        vm.prank(alice);
        assertTrue(token.approve(bob, 30 ether));
        vm.prank(bob);
        assertTrue(token.transferFrom(alice, bob, 20 ether));
        assertEq(token.balanceOf(alice), 80 ether);
        assertEq(token.balanceOf(bob), 20 ether);
        assertEq(token.allowance(alice, bob), 10 ether);
        assertEq(token.totalSupply(), 1e27);
    }

    function test_allowanceCannotBeExceeded() public {
        token.transfer(alice, 100 ether);
        vm.prank(alice);
        token.approve(bob, 10 ether);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 10 ether, 11 ether)
        );
        vm.prank(bob);
        token.transferFrom(alice, bob, 11 ether);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.allowance(alice, bob), 10 ether);
    }

    function test_insufficientBalanceFails() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 1));
        vm.prank(alice);
        token.transfer(bob, 1);
    }

    function test_zeroRecipientFails() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
    }

    function test_selfAndZeroTransfersDoNotChangeSupply() public {
        token.transfer(address(this), 10 ether);
        token.transfer(alice, 0);
        assertEq(token.balanceOf(address(this)), 1e27);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.totalSupply(), 1e27);
    }

    function test_approvalCanBeRevoked() public {
        token.approve(bob, 10 ether);
        token.approve(bob, 0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, 1));
        vm.prank(bob);
        token.transferFrom(address(this), bob, 1);
    }

    function test_noMintAdminOrUpgradeSelectorsForDeployerOrStranger() public {
        bytes[9] memory attempts = [
            abi.encodeWithSignature("mint(address,uint256)", alice, 1e27),
            abi.encodeWithSignature("mint(uint256)", 1e27),
            abi.encodeWithSignature("setOwner(address)", alice),
            abi.encodeWithSignature("transferOwnership(address)", alice),
            abi.encodeWithSignature("upgradeTo(address)", alice),
            abi.encodeWithSignature("initialize(address)", alice),
            abi.encodeWithSignature("pause()"),
            abi.encodeWithSignature("setMinter(address)", alice),
            abi.encodeWithSignature("burn(uint256)", 1)
        ];
        for (uint256 i; i < attempts.length; ++i) {
            (bool deployerOk,) = address(token).call(attempts[i]);
            assertFalse(deployerOk);
            vm.prank(alice);
            (bool strangerOk,) = address(token).call(attempts[i]);
            assertFalse(strangerOk);
        }
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
        assertEq(token.balanceOf(alice), 0);
    }
}
