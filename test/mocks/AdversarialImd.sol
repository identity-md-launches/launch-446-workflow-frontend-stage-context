// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ImdCardPayment} from "../../src/ImdCardPayment.sol";

contract AdversarialImd is ERC20 {
    enum Mode {
        Normal,
        FalsePull,
        FalsePush,
        NoopPull,
        NoopPush,
        TaxPull,
        TaxPush,
        RevertPush,
        ReenterCaught,
        ReenterBubbled
    }

    Mode public mode;
    ImdCardPayment public target;
    uint256 public callbackCount;
    bytes4 public callbackError;

    constructor() ERC20("Test IMD", "TIMD") {
        _mint(msg.sender, 1e27);
    }

    function configure(Mode mode_, ImdCardPayment target_) external {
        mode = mode_;
        target = target_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (mode == Mode.FalsePull) return false;
        if (mode == Mode.NoopPull) return true;
        _callback();
        bool result = super.transferFrom(from, to, amount);
        if (mode == Mode.TaxPull) _burn(to, 1);
        return result;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (mode == Mode.FalsePush) return false;
        if (mode == Mode.NoopPush) return true;
        if (mode == Mode.RevertPush) revert("push failed");
        _callback();
        bool result = super.transfer(to, amount);
        if (mode == Mode.TaxPush) _burn(to, 1);
        return result;
    }

    function _callback() internal {
        if (mode == Mode.ReenterBubbled) target.pay(1, bytes32(uint256(123)), type(uint256).max);
        if (mode != Mode.ReenterCaught) return;
        ++callbackCount;
        (bool ok, bytes memory reason) =
            address(target).call(abi.encodeCall(target.pay, (1, bytes32(uint256(123)), type(uint256).max)));
        require(!ok, "reentry succeeded");
        callbackError = bytes4(reason);
    }
}

contract SixDecimalImd is AdversarialImd {
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @dev Models a legacy ERC-20 that transfers correctly but returns no bytes.
contract NoReturnImd {
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() {
        balanceOf[msg.sender] = 1e27;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}
