// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {ImdCardPayment} from "../src/ImdCardPayment.sol";

/// @dev Test-only stand-in for factory CREATE2 deployment. It performs no initialization calls.
contract DeploymentHarness {
    function deploy(bytes memory initCode, bytes32 salt, uint256 value) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(value, add(initCode, 32), mload(initCode), salt)
        }
        require(deployed != address(0), "constructor failed");
    }
}

contract DeploymentTest is Test {
    function test_factoryDeploymentPreservesSupplyAndUsesExplicitRecipient() public {
        vm.chainId(11155111);
        DeploymentHarness factory = new DeploymentHarness();
        address operator = address(0xC0FFEE);
        LaunchToken token = LaunchToken(factory.deploy(type(LaunchToken).creationCode, bytes32(uint256(1)), 0));
        assertEq(token.balanceOf(address(factory)), 1e27);
        bytes memory appCode = abi.encodePacked(
            type(ImdCardPayment).creationCode, abi.encode(address(token), operator, uint256(20e8), uint256(1e6))
        );
        ImdCardPayment app = ImdCardPayment(factory.deploy(appCode, bytes32(uint256(2)), 0));
        assertEq(app.settlementRecipient(), operator);
        assertEq(address(app.imd()), address(token));
        assertEq(app.quote(3), 6480 ether);
        assertEq(token.balanceOf(address(factory)), 1e27);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(app)), 0);
        assertEq(token.balanceOf(operator), 0);
        _assertRuntime(address(token));
        _assertRuntime(address(app));
    }

    function test_applicationConstructorRejectsEther() public {
        vm.chainId(11155111);
        DeploymentHarness factory = new DeploymentHarness();
        vm.deal(address(factory), 1 ether);
        LaunchToken token = new LaunchToken();
        bytes memory appCode = abi.encodePacked(
            type(ImdCardPayment).creationCode, abi.encode(address(token), address(0xCAFE), uint256(20e8), uint256(1e6))
        );
        vm.expectRevert("constructor failed");
        factory.deploy(appCode, bytes32(uint256(1)), 1);
    }

    function _assertRuntime(address deployed) private view {
        bytes memory code = deployed.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
            } else {
                assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
            }
        }
    }
}
