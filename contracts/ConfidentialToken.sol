// SPDX-License-Identifier: BSD-3-Clause-Clear
/**
 * @title ConfidentialToken
 * @author Randy Bhattu
 * @notice Encrypted ERC token using FHEVM
 */
pragma solidity ^0.8.24;

import { FHE, CoprocessorConfig, euint8, externalEuint8, ebool } from "@fhevm/solidity/lib/FHE.sol";

contract ConfidentialToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals = 0;

    address public owner;

    mapping(address => euint8) private _balances;
    mapping(address => mapping(address => euint8)) private _allowances;

    struct LastError {
        euint8 code;      // 0=OK, 1=NO_BALANCE, 2=NO_ALLOWANCE
        uint256 timestamp;
    }
    mapping(address => LastError) private _lastErrors;

    euint8 private _NO_ERROR;
    euint8 private _NOT_ENOUGH_BALANCE;
    euint8 private _NOT_ENOUGH_ALLOWANCE;

    event Transfer(address indexed from, address indexed to, bytes32 amountHandle);
    event Approval(address indexed owner, address indexed spender, bytes32 amountHandle);
    event ErrorChanged(address indexed user, bytes32 codeHandle, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address aclAdd,
        address fhevmExecutorAdd,
        address kmsVerifierAdd,
        address decryptionOracleAdd
    ) {
        name = name_;
        symbol = symbol_;
        owner = msg.sender;

        FHE.setCoprocessor(
            CoprocessorConfig({
                ACLAddress: aclAdd,
                CoprocessorAddress: fhevmExecutorAdd,
                DecryptionOracleAddress: decryptionOracleAdd,
                KMSVerifierAddress: kmsVerifierAdd
            })
        );

        _NO_ERROR = FHE.asEuint8(0);
        _NOT_ENOUGH_BALANCE = FHE.asEuint8(1);
        _NOT_ENOUGH_ALLOWANCE = FHE.asEuint8(2);

        FHE.allowThis(_NO_ERROR);
        FHE.allowThis(_NOT_ENOUGH_BALANCE);
        FHE.allowThis(_NOT_ENOUGH_ALLOWANCE);
    }

    function _ensureBalance(address user) internal {
        if (!FHE.isInitialized(_balances[user])) {
            euint8 z = FHE.asEuint8(0);
            _balances[user] = z;
            FHE.allowThis(z);
            FHE.allow(z, user);
        }
    }

    function _ensureAllowance(address owner_, address spender) internal {
        if (!FHE.isInitialized(_allowances[owner_][spender])) {
            euint8 z = FHE.asEuint8(0);
            _allowances[owner_][spender] = z;
            FHE.allowThis(z);
            FHE.allow(z, owner_); // Optional -> let owner decrypt their allowance
        }
    }

    function _setLastError(address user, euint8 code) internal {
        _lastErrors[user] = LastError({ code: code, timestamp: block.timestamp });
        FHE.allowThis(code);
        FHE.allow(code, user);
        emit ErrorChanged(user, FHE.toBytes32(code), block.timestamp);
    }

    function getLastError(address user) external view returns (euint8 code, uint256 timestamp) {
        LastError storage le = _lastErrors[user];
        return (le.code, le.timestamp);
    }

    //changed from return FHE.asEuint8(0) to _ensureAllowance
    function balanceOf(address user) external returns (euint8) {
        _ensureBalance(user);
        return _balances[user];
    }

    //changed from return FHE.asEuint8(0) to _ensureAllowance
    function allowanceOf(address owner_, address spender) external returns (euint8) {
        _ensureAllowance(owner_, spender);
        return _allowances[owner_][spender];
    }


    function mint(address to, uint8 amount) external onlyOwner {
        _ensureBalance(to);

        euint8 amt = FHE.asEuint8(amount);
        euint8 newBal = FHE.add(_balances[to], amt);
        _balances[to] = newBal;

        FHE.allowThis(newBal);
        FHE.allow(newBal, to);

        emit Transfer(address(0), to, FHE.toBytes32(amt));
        _setLastError(to, _NO_ERROR);
    }

    function approve(address spender, externalEuint8 amountExt, bytes calldata inputProof) external {
        _ensureAllowance(msg.sender, spender);

        euint8 amount = FHE.fromExternal(amountExt, inputProof);
        _allowances[msg.sender][spender] = amount;

        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);

        emit Approval(msg.sender, spender, FHE.toBytes32(amount));
        _setLastError(msg.sender, _NO_ERROR);
    }

    function transfer(address to, externalEuint8 amountExt, bytes calldata inputProof) external {
        _ensureBalance(msg.sender);
        _ensureBalance(to);

        euint8 amount = FHE.fromExternal(amountExt, inputProof);

        ebool hasFunds = FHE.le(amount, _balances[msg.sender]);
        euint8 zero = FHE.asEuint8(0);
        euint8 xfer = FHE.select(hasFunds, amount, zero);

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], xfer);
        _balances[to] = FHE.add(_balances[to], xfer);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        euint8 err = FHE.select(hasFunds, _NO_ERROR, _NOT_ENOUGH_BALANCE);
        _setLastError(msg.sender, err);

        emit Transfer(msg.sender, to, FHE.toBytes32(xfer));
    }

    /// Pool/contract sends from its own balance using a ciphertext amount handle.
    /// Caller must be authorized for `amount` (and should grant transient access to this token contract).
    function transferEncrypted(address to, euint8 amount) external {
        require(FHE.isSenderAllowed(amount), "AMOUNT_NOT_ALLOWED_FOR_SENDER");

        _ensureBalance(msg.sender);
        _ensureBalance(to);

        ebool hasFunds = FHE.le(amount, _balances[msg.sender]);
        euint8 zero = FHE.asEuint8(0);
        euint8 xfer = FHE.select(hasFunds, amount, zero);

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], xfer);
        _balances[to] = FHE.add(_balances[to], xfer);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        euint8 err = FHE.select(hasFunds, _NO_ERROR, _NOT_ENOUGH_BALANCE);
        _setLastError(msg.sender, err);

        emit Transfer(msg.sender, to, FHE.toBytes32(xfer));
    }

    /// Pool pulls from user using encrypted allowance + ciphertext amount handle.
    /// Caller must be authorized for `amount` (and should grant transient access to this token contract).
    function transferFromEncrypted(address from, address to, euint8 amount) external {
        require(FHE.isSenderAllowed(amount), "AMOUNT_NOT_ALLOWED_FOR_SENDER");

        _ensureBalance(from);
        _ensureBalance(to);
        _ensureAllowance(from, msg.sender);

        euint8 zero = FHE.asEuint8(0);

        ebool hasAllowance = FHE.le(amount, _allowances[from][msg.sender]);
        ebool hasFunds = FHE.le(amount, _balances[from]);
        ebool ok = FHE.and(hasAllowance, hasFunds);

        euint8 xfer = FHE.select(ok, amount, zero);

        _balances[from] = FHE.sub(_balances[from], xfer);
        _balances[to] = FHE.add(_balances[to], xfer);
        _allowances[from][msg.sender] = FHE.sub(_allowances[from][msg.sender], xfer);

        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        FHE.allowThis(_allowances[from][msg.sender]);
        FHE.allow(_allowances[from][msg.sender], from);

        euint8 errIfFail = FHE.select(hasAllowance, _NOT_ENOUGH_BALANCE, _NOT_ENOUGH_ALLOWANCE);
        euint8 err = FHE.select(ok, _NO_ERROR, errIfFail);
        _setLastError(from, err);

        emit Transfer(from, to, FHE.toBytes32(xfer));
    }
}