// SPDX-License-Identifier: BSD-3-Clause-Clear
/**
 * @title ConfidentialSwapPool
 * @author Randy Bhattu
 * @notice Encrypted AMM Pool for 2 Tokens
 */
pragma solidity ^0.8.24;

import {FHE, CoprocessorConfig, euint8, externalEuint8, ebool} from "@fhevm/solidity/lib/FHE.sol";

import "hardhat/console.sol";

interface IConfidentialToken {
    function transferFromEncrypted(
        address from,
        address to,
        euint8 amount
    ) external;

    function transferEncrypted(address to, euint8 amount) external;
}

contract ConfidentialSwapPool {
    address public token0;
    address public token1;

    uint8 public fee; //0-255
    uint16 public maxRounds; //for stress knob rounds

    euint8 private immutable _zero;

    mapping(address => euint8) private _lastOut0;
    mapping(address => euint8) private _lastOut1;
    mapping(address => euint8) private _lastReceipt;

    event SwapExecuted(
        address indexed user,
        bytes32 out0Handle,
        bytes32 out1Handle,
        bytes32 receiptHandle
    );

    constructor(
        address token0_,
        address token1_,
        uint8 fee_,
        uint16 maxRounds_,
        address aclAdd,
        address fhevmExecutorAdd,
        address kmsVerifierAdd,
        address decryptionOracleAdd
    ) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        maxRounds = maxRounds_;

        FHE.setCoprocessor(
            CoprocessorConfig({
                ACLAddress: aclAdd,
                CoprocessorAddress: fhevmExecutorAdd,
                DecryptionOracleAddress: decryptionOracleAdd,
                KMSVerifierAddress: kmsVerifierAdd
            })
        );
        _zero = FHE.asEuint8(0); // this is a const
        FHE.allowThis(_zero);
    }

    function getLastHandles(
        address user
    ) external view returns (bytes32 out0, bytes32 out1, bytes32 receipt) {
        out0 = FHE.isInitialized(_lastOut0[user])
            ? FHE.toBytes32(_lastOut0[user])
            : bytes32(0);
        out1 = FHE.isInitialized(_lastOut1[user])
            ? FHE.toBytes32(_lastOut1[user])
            : bytes32(0);
        receipt = FHE.isInitialized(_lastReceipt[user])
            ? FHE.toBytes32(_lastReceipt[user])
            : bytes32(0);
    }

    function swap(
        externalEuint8 aInExt,
        externalEuint8 bInExt,
        bytes calldata inputProof,
        uint16 rounds
    ) external {
        require(rounds <= maxRounds, "ROUNDS_TOO_HIGH");

        euint8 aIn = FHE.fromExternal(aInExt, inputProof); // Validate encrypt input (ZKPoK + bound to msg.sender + this contract)
        euint8 bIn = FHE.fromExternal(bInExt, inputProof);

        FHE.allowTransient(aIn, token0); // retreive user -> pool (make sure we did prior approve(pool))
        IConfidentialToken(token0).transferFromEncrypted(
            msg.sender,
            address(this),
            aIn
        );

        FHE.allowTransient(bIn, token1);
        IConfidentialToken(token1).transferFromEncrypted(
            msg.sender,
            address(this),
            bIn
        );

        euint8 feeEnc = FHE.asEuint8(fee); //out --> out0 = bIn - fee, out1 = aIn - fee

        ebool bOk = FHE.ge(bIn, feeEnc);
        euint8 out0 = FHE.select(bOk, FHE.sub(bIn, feeEnc), _zero);

        ebool aOk = FHE.ge(aIn, feeEnc);
        euint8 out1 = FHE.select(aOk, FHE.sub(aIn, feeEnc), _zero);

        FHE.allowTransient(out0, token0); //pool -> user
        IConfidentialToken(token0).transferEncrypted(msg.sender, out0);

        FHE.allowTransient(out1, token1);
        IConfidentialToken(token1).transferEncrypted(msg.sender, out1);

        euint8 acc = FHE.add(aIn, bIn); //lets stress this baby (heavy fhe receipt) lol its just a bunch of fhe ops
        for (uint16 i = 0; i < rounds; i++) {
            acc = FHE.add(acc, aIn);
            acc = FHE.sub(acc, bIn);
            acc = FHE.xor(acc, aIn);
            acc = FHE.add(acc, acc);
        }

        _lastOut0[msg.sender] = out0;
        _lastOut1[msg.sender] = out1;
        _lastReceipt[msg.sender] = acc;

        //allow public decrypt for now
        FHE.allowThis(out0);
        FHE.allow(out0, msg.sender);
        //FHE.makePubliclyDecryptable(out0);
        FHE.allowThis(out1);
        FHE.allow(out1, msg.sender);
        //FHE.makePubliclyDecryptable(out1);
        FHE.allowThis(acc);
        FHE.allow(acc, msg.sender);
        //FHE.makePubliclyDecryptable(acc);

        console.log("Swap executed: out0 handle ");
        console.logBytes32(FHE.toBytes32(out0));
        console.log(" out1 handle ");
        console.logBytes32(FHE.toBytes32(out1));
        console.log(" receipt handle ");
        console.logBytes32(FHE.toBytes32(acc));

        emit SwapExecuted(
            msg.sender,
            FHE.toBytes32(out0),
            FHE.toBytes32(out1),
            FHE.toBytes32(acc)
        );
    }
}
