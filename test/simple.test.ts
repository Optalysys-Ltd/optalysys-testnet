import { Test, Test__factory } from "../typechain-types";
import { HardhatFhevmRuntimeEnvironment } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm as mockFhevm } from "hardhat";
import { createInstance, loadTestnetConfig, loadWallet, timestampLog } from "../tasks/utils";
import { JsonRpcProvider, HDNodeWallet } from "ethers";
import { FhevmInstance } from "@zama-fhe/relayer-sdk/node";


async function deployFixture() {
    const keyFile = "key.json";
    const networkName = process.env.NETWORK || "hardhat";
    let wallet: HDNodeWallet;
    let contractFactory: Test__factory;
    let walletAddress: string;
    let fhevm: FhevmInstance | HardhatFhevmRuntimeEnvironment;
    timestampLog("Network name: " + networkName);
    const configFile = networkName == "optalysys" ? "networks/blue.json" : "mocked_config.json";
    if (networkName == "optalysys") {
        timestampLog("Loading wallet")
        wallet = await loadWallet(keyFile) as HDNodeWallet;
        walletAddress = wallet.address;
    } else {
        timestampLog("Running on hardhat, using mocked config");
        const signers = await ethers.getSigners();
        wallet = signers[0];
        walletAddress = wallet.address;
    }

    timestampLog("Loading testnet config")
    const testnetConfig = await loadTestnetConfig(configFile);
    timestampLog("Connecting provider")

    const provider = ethers.getDefaultProvider(testnetConfig.jsonRpcUrl) as JsonRpcProvider;
    if (networkName == "optalysys") {
        timestampLog("Connecting wallet");
        wallet = wallet.connect(provider);
        contractFactory = new Test__factory(wallet);
        timestampLog("Creating fhevm instance");

        fhevm = await createInstance(
            testnetConfig.decryptionContractAddress,
            testnetConfig.inputVerificationContractAddress,
            testnetConfig.inputVerifierContractAddress,
            testnetConfig.kmsVerifierContractAddress,
            testnetConfig.aclContractAddress,
            testnetConfig.gatewayChainId,
            testnetConfig.relayerUrl,
            testnetConfig.jsonRpcUrl,
        )
    } else {
        contractFactory = await ethers.getContractFactory("Test") as unknown as Test__factory;
        timestampLog("Using mock fhevm");
        fhevm = mockFhevm;
    }

    timestampLog("Deploying contract")
    const simpleContract = await contractFactory.deploy(
        ethers.getAddress(testnetConfig.aclContractAddress),
        ethers.getAddress(testnetConfig.fhevmExecutorContractAddress),
        ethers.getAddress(testnetConfig.kmsVerifierContractAddress),
        ethers.getAddress(testnetConfig.decryptionOracleContractAddress),
    );
    timestampLog("Waiting for deployment...")
    const receipt = await (await simpleContract.waitForDeployment()).deploymentTransaction()?.wait()
    timestampLog("Contract deployed at block: " + receipt?.blockNumber);
    const simpleContractAddress = receipt?.contractAddress as string;
    timestampLog("Contract address: " + simpleContractAddress)


    return { simpleContract, simpleContractAddress, wallet, walletAddress, fhevm };
}

describe("Simple", function () {
    let simpleContract: Test;
    let simpleContractAddress: string;
    let wallet: HDNodeWallet;
    let fhevm: FhevmInstance | HardhatFhevmRuntimeEnvironment;
    let walletAddress: string;

    before(async () => {
        ({ simpleContract, simpleContractAddress, wallet, walletAddress, fhevm } = await deployFixture());
    });

    it("encrypted simple value should be uninitialized after deployment", async function () {
        const encryptedSimpleValue = await simpleContract.encryptedSimpleValue();
        // Expect initial value to be bytes32(0) after deployment,
        // (meaning the encrypted value is uninitialized)
        expect(encryptedSimpleValue).to.eq(ethers.ZeroHash);
    });

    it("store value 4", async function () {
        const encryptedValueBeforeStore = await simpleContract.encryptedSimpleValue();
        expect(encryptedValueBeforeStore).to.eq(ethers.ZeroHash);

        // Encrypt constant 4 as a euint8
        const clearFour = 4;
        const encryptedFour = await fhevm
            .createEncryptedInput(simpleContractAddress, walletAddress)
            .add8(clearFour)
            .encrypt();

        const tx = await simpleContract
            .connect(wallet)
            .storeEncryptedSimpleValue(encryptedFour.handles[0], encryptedFour.inputProof);
        await tx.wait();

        const encryptedValueAfterStore = await simpleContract.encryptedSimpleValue();
        const clearCountAfterStore = await fhevm.publicDecrypt([encryptedValueAfterStore]);
        expect(clearCountAfterStore[encryptedValueAfterStore]).to.eq(clearFour);
    }).timeout(4 * 60 * 1000);

    it("encrypted sum should be uninitialized after deployment", async function () {
        const encryptedSum = await simpleContract.encryptedSum();
        // Expect initial value to be bytes32(0) after deployment,
        // (meaning the encrypted value is uninitialized)
        expect(encryptedSum).to.eq(ethers.ZeroHash);
    });

    it("store sum", async function () {

        const encryptedSumBeforeStore = await simpleContract.encryptedSum();
        expect(encryptedSumBeforeStore).to.eq(ethers.ZeroHash);

        // Encrypt constant 4 as a euint8 and constant 13 as euint8
        const clearFour = 4;
        const clearThirteen = 13;
        const encryptedInputs = await fhevm
            .createEncryptedInput(simpleContractAddress, walletAddress)
            .add8(clearFour)
            .add8(clearThirteen)
            .encrypt();


        // Set sum to 4 + 13
        let tx = await simpleContract
            .connect(wallet)
            .storeEncryptedSum(encryptedInputs.handles[0], encryptedInputs.handles[1], encryptedInputs.inputProof)
        await tx.wait();


        const encryptedSumAfterStore = await simpleContract.encryptedSum();
        const clearSumAfterStore = await fhevm.publicDecrypt([encryptedSumAfterStore])

        expect(clearSumAfterStore[encryptedSumAfterStore]).to.eq(clearFour + clearThirteen);
    }).timeout(4 * 60 * 1000);
});