// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "src/LaunchToken.sol";

contract LaunchTokenModelHandler is Test {
    uint256 private constant SUPPLY = 1e27;
    LaunchToken public immutable token;
    address[4] public actors = [address(0x1111), address(0x2222), address(0x3333), address(0x4444)];
    uint256[4] public balances;
    mapping(uint256 => mapping(uint256 => uint256)) public allowances;
    uint256 public successfulSpends;
    uint256 public failedSpends;

    constructor(LaunchToken token_) {
        token = token_;
        for (uint256 i; i < 4; ++i) {
            balances[i] = SUPPLY / 4;
        }
    }

    function approve(uint256 ownerSeed, uint256 spenderSeed, uint256 amountSeed, uint8 mode) external {
        uint256 owner = ownerSeed % 4;
        uint256 spender = spenderSeed % 4;
        uint256 amount = mode % 3 == 0 ? 0 : mode % 3 == 1 ? type(uint256).max : amountSeed;
        vm.prank(actors[owner]);
        assertTrue(token.approve(actors[spender], amount));
        allowances[owner][spender] = amount;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amountSeed, uint8 mode) external {
        uint256 from = fromSeed % 4;
        uint256 to = toSeed % 4;
        uint256 amount = _amount(from, amountSeed, mode);
        if (amount > balances[from]) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IERC20Errors.ERC20InsufficientBalance.selector, actors[from], balances[from], amount
                )
            );
            vm.prank(actors[from]);
            token.transfer(actors[to], amount);
        } else {
            vm.prank(actors[from]);
            assertTrue(token.transfer(actors[to], amount));
            _move(from, to, amount);
        }
    }

    function spend(uint256 spenderSeed, uint256 fromSeed, uint256 toSeed, uint256 amountSeed, uint8 mode) external {
        uint256 spender = spenderSeed % 4;
        uint256 from = fromSeed % 4;
        uint256 to = toSeed % 4;
        uint256 amount = _amount(from, amountSeed, mode);
        uint256 allowed = allowances[from][spender];
        bytes memory error;
        if (amount > allowed) {
            error = abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, actors[spender], allowed, amount
            );
        } else if (amount > balances[from]) {
            error = abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, actors[from], balances[from], amount
            );
        }
        if (error.length != 0) {
            vm.expectRevert(error);
            vm.prank(actors[spender]);
            token.transferFrom(actors[from], actors[to], amount);
            ++failedSpends;
        } else {
            vm.prank(actors[spender]);
            assertTrue(token.transferFrom(actors[from], actors[to], amount));
            _move(from, to, amount);
            if (allowed != type(uint256).max) allowances[from][spender] -= amount;
            ++successfulSpends;
        }
    }

    function _amount(uint256 from, uint256 seed, uint8 mode) private view returns (uint256) {
        mode %= 4;
        if (mode == 0) return 0;
        if (mode == 1) return balances[from];
        if (mode == 2) return bound(seed, 0, balances[from]);
        return balances[from] + 1;
    }

    function _move(uint256 from, uint256 to, uint256 amount) private {
        balances[from] -= amount;
        balances[to] += amount;
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract LaunchTokenInvariantTest is Test {
    LaunchToken private token;
    LaunchTokenModelHandler private handler;

    function setUp() public {
        token = new LaunchToken();
        handler = new LaunchTokenModelHandler(token);
        for (uint256 i; i < 4; ++i) {
            token.transfer(handler.actors(i), 1e27 / 4);
            handler.approve(i, (i + 1) % 4, 1e27 / 8, uint8(i % 2 + 1));
        }
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.transfer.selector;
        selectors[1] = handler.approve.selector;
        selectors[2] = handler.spend.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_fixedSupplyAndEveryBalanceMatchLedger() public view {
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            uint256 actual = token.balanceOf(handler.actors(i));
            assertEq(actual, handler.balances(i), "transfer created value or moved the wrong amount");
            sum += actual;
        }
        assertEq(sum, 1e27);
        assertEq(token.totalSupply(), sum);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(address(handler)), 0);
        assertEq(token.balanceOf(address(token)), 0);
        assertEq(token.balanceOf(address(0)), 0);
    }

    function invariant_allowanceIsolationRevocationAndAtomicFailure() public view {
        for (uint256 i; i < 4; ++i) {
            for (uint256 j; j < 4; ++j) {
                assertEq(token.allowance(handler.actors(i), handler.actors(j)), handler.allowances(i, j));
            }
        }
    }

    function test_fullSupplyInfiniteApprovalRevocationAndFailedSpend() public {
        for (uint256 i = 1; i < 4; ++i) {
            handler.transfer(i, 0, 0, 1);
        }
        assertEq(token.balanceOf(handler.actors(0)), 1e27);
        handler.approve(0, 1, 0, 1);
        handler.spend(1, 0, 1, 0, 1); // Entire supply via infinite approval.
        assertEq(token.balanceOf(handler.actors(1)), 1e27);
        assertEq(token.allowance(handler.actors(0), handler.actors(1)), type(uint256).max);
        handler.spend(1, 0, 1, 0, 3); // Empty balance; infinite approval must survive failure.
        handler.approve(1, 2, 1e27, 2);
        handler.spend(2, 1, 1, 1, 2); // Delegated self transfer still consumes finite allowance.
        assertEq(token.balanceOf(handler.actors(1)), 1e27);
        assertEq(token.allowance(handler.actors(1), handler.actors(2)), 1e27 - 1);
        handler.approve(1, 2, 0, 0);
        handler.spend(2, 1, 0, 1, 2);
        invariant_fixedSupplyAndEveryBalanceMatchLedger();
        invariant_allowanceIsolationRevocationAndAtomicFailure();
        assertEq(handler.successfulSpends(), 2);
        assertEq(handler.failedSpends(), 2);
    }
}
