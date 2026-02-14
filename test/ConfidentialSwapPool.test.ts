import { ConfidentialSwapPool, ConfidentialSwapPool__factory, ConfidentialToken, ConfidentialToken__factory } from "../typechain-types";
import { FhevmType, HardhatFhevmRuntimeEnvironment } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm as mockFhevm } from "hardhat";
import { createInstance, loadTestnetConfig, loadWallet, timestampLog } from "../tasks/utils";
import { JsonRpcProvider, HDNodeWallet } from "ethers";
import { FhevmInstance } from "@zama-fhe/relayer-sdk/node";


const FEE = 6;
const MAX_ROUNDS = 10;


async function deployFixture() {
    const keyFile = "key.json";
    const networkName = process.env.NETWORK || "hardhat";
    let wallet: HDNodeWallet;
    let wallet0: HDNodeWallet;
    let wallet1: HDNodeWallet;
    let confidentialSwapPoolFactory: ConfidentialSwapPool__factory;
    let confidentialTokenFactory: ConfidentialToken__factory;
    let walletAddress: string;
    let fhevm: FhevmInstance | HardhatFhevmRuntimeEnvironment;
    let provider: JsonRpcProvider;
    timestampLog("Network name: " + networkName);
    const configFile = networkName == "optalysys" ? "networks/blue.json" : "mocked_config.json";
    if (networkName == "optalysys") {
        timestampLog("Loading wallet")
        wallet = await loadWallet(keyFile) as HDNodeWallet;
        wallet0 = await loadWallet(keyFile) as HDNodeWallet;
        wallet1 = await loadWallet(keyFile) as HDNodeWallet;
        walletAddress = wallet.address;
    } else {
        timestampLog("Running on hardhat, using mocked config");
        const signers = await ethers.getSigners();
        wallet = signers[0];
        wallet0 = signers[1];
        wallet1 = signers[2];
        walletAddress = wallet.address;
    }

    timestampLog("Loading testnet config")
    const testnetConfig = await loadTestnetConfig(configFile);
    timestampLog("Connecting provider")

    provider = ethers.getDefaultProvider(testnetConfig.jsonRpcUrl) as JsonRpcProvider;
    if (networkName == "optalysys") {
        timestampLog("Connecting wallet");
        wallet = wallet.connect(provider);
        confidentialSwapPoolFactory = new ConfidentialSwapPool__factory(wallet);
        confidentialTokenFactory = new ConfidentialToken__factory(wallet);
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
        confidentialTokenFactory = await ethers.getContractFactory("ConfidentialToken") as unknown as ConfidentialToken__factory;
        confidentialSwapPoolFactory = await ethers.getContractFactory("ConfidentialSwapPool") as unknown as ConfidentialSwapPool__factory;
        timestampLog("Using mock fhevm");
        fhevm = mockFhevm;
    }

    timestampLog("Deploying contract")
    const confidentialToken1 = await confidentialTokenFactory.connect(wallet0).deploy("Confidential Token 1", "CTK1", ethers.getAddress(testnetConfig.aclContractAddress),
        ethers.getAddress(testnetConfig.fhevmExecutorContractAddress),
        ethers.getAddress(testnetConfig.kmsVerifierContractAddress),
        ethers.getAddress(testnetConfig.decryptionOracleContractAddress),);
    await confidentialToken1.waitForDeployment();
    const confidentialToken1Address = confidentialToken1.target;
    timestampLog("Confidential Token 1 deployed at: " + confidentialToken1Address);
    const confidentialToken2 = await confidentialTokenFactory.connect(wallet1).deploy("Confidential Token 2", "CTK2", ethers.getAddress(testnetConfig.aclContractAddress),
        ethers.getAddress(testnetConfig.fhevmExecutorContractAddress),
        ethers.getAddress(testnetConfig.kmsVerifierContractAddress),
        ethers.getAddress(testnetConfig.decryptionOracleContractAddress),);
    await confidentialToken2.waitForDeployment();
    const confidentialToken2Address = confidentialToken2.target;
    timestampLog("Confidential Token 2 deployed at: " + confidentialToken2Address);

    const confidentialSwapPoolContract = await confidentialSwapPoolFactory.deploy(
        confidentialToken1Address,
        confidentialToken2Address,
        FEE,
        MAX_ROUNDS,
        ethers.getAddress(testnetConfig.aclContractAddress),
        ethers.getAddress(testnetConfig.fhevmExecutorContractAddress),
        ethers.getAddress(testnetConfig.kmsVerifierContractAddress),
        ethers.getAddress(testnetConfig.decryptionOracleContractAddress),
    );
    timestampLog("Waiting for deployment...")
    const receipt = await (await confidentialSwapPoolContract.waitForDeployment()).deploymentTransaction()?.wait()
    timestampLog("Contract deployed at block: " + receipt?.blockNumber);
    const confidentialSwapPoolAddress = receipt?.contractAddress as string;
    timestampLog("Contract address: " + confidentialSwapPoolAddress);



    return { confidentialSwapPoolContract, confidentialSwapPoolAddress, wallet, walletAddress, fhevm, provider, confidentialToken1, confidentialToken2, wallet0, wallet1 };
}

describe("ConfidentialSwapPool", function () {
    let confidentialSwapPoolContract: ConfidentialSwapPool;
    let confidentialSwapPoolAddress: string;
    let wallet: HDNodeWallet;
    let fhevm: FhevmInstance | HardhatFhevmRuntimeEnvironment;
    let walletAddress: string;
    let provider: JsonRpcProvider;
    let confidentialToken1: ConfidentialToken;
    let confidentialToken2: ConfidentialToken;
    let wallet0: HDNodeWallet;
    let wallet1: HDNodeWallet;

    before(async () => {
        ({ confidentialSwapPoolContract, confidentialSwapPoolAddress, wallet, walletAddress, fhevm, provider, confidentialToken1, confidentialToken2, wallet0, wallet1 } = await deployFixture());
    });

    it("perform a swap", async function () {
        const ROUNDS = 2;
        // Encrypt a and b
        const clearA = 213;
        const clearB = 78;
        const encryptedInputs = await fhevm
            .createEncryptedInput(confidentialSwapPoolAddress, walletAddress)
            .add8(clearA)
            .add8(clearB)
            .encrypt();


        // Set sum to 4 + 13
        let tx = await confidentialSwapPoolContract
            .connect(wallet)
            .swap(encryptedInputs.handles[0], encryptedInputs.handles[1], encryptedInputs.inputProof, ROUNDS);
        const receipt = await tx.wait();
        const fromBlock = 0;
        const toBlock = receipt?.blockNumber || 0;


        const token0Filter = confidentialToken1.filters.Transfer();
        const token1Filter = confidentialToken2.filters.Transfer();

        const token0Events = await confidentialToken1.queryFilter(token0Filter, fromBlock, toBlock);
        const token1Events = await confidentialToken2.queryFilter(token1Filter, fromBlock, toBlock);

        token0Events.forEach((event) => {
            console.log(`ConfidentialToken1 TransferFromEncrypted - Block Number: ${event.blockNumber}, From: ${event.args[0]}, To: ${event.args[1]}, AmountHandle: ${event.args[2]}`);
        });

        token1Events.forEach((event) => {
            console.log(`ConfidentialToken2 TransferFromEncrypted - Block Number: ${event.blockNumber}, From: ${event.args[0]}, To: ${event.args[1]}, AmountHandle: ${event.args[2]}`);
        });

        const filter = confidentialSwapPoolContract.filters.SwapExecuted();
        // Or filter by specific indexed parameters (e.g., 'to' address)
        // const filter = contract.filters.Transfer(null, "RECIPIENT_ADDRESS");


        // 3. Query the events
        const events = await confidentialSwapPoolContract.queryFilter(filter, fromBlock, toBlock);

        // 4. Process the events
        events.forEach(async (event) => {
            console.log(`Block Number: ${event.blockNumber}`);
            console.log(`Sender: ${event.args[0]}, Out0handle: ${event.args[1]}, Out1handle: ${event.args[2]} receiptHandle: ${event.args[3]}`);
            const out0Handle = event.args[1];
            const out1Handle = event.args[2];
            const receiptHandle = event.args[3];

            if (fhevm.isMock) {
                // Decrypt outputs
                fhevm = fhevm as HardhatFhevmRuntimeEnvironment;
                const decryptSwap = async () => {
                    const out0Decrypted = await fhevm.userDecryptEuint(
                        FhevmType.euint8,
                        out0Handle,
                        confidentialSwapPoolAddress,
                        wallet,
                    );
                    const out1Decrypted = await fhevm.userDecryptEuint(
                        FhevmType.euint8,
                        out1Handle,
                        confidentialSwapPoolAddress,
                        wallet,
                    );
                    const receiptDecrypted = await fhevm.userDecryptEuint(
                        FhevmType.euint8,
                        receiptHandle,
                        confidentialSwapPoolAddress,
                        wallet,
                    );

                    console.log(`Decrypted out0: ${out0Decrypted}, Decrypted out1: ${out1Decrypted}, Decrypted receipt: ${receiptDecrypted}`);
                    expect(out0Decrypted).to.eq(clearB - FEE);
                    expect(out1Decrypted).to.eq(clearA - FEE);
                };
                await decryptSwap();
            }
        });

    });
});