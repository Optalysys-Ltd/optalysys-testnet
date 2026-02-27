import { FHECounter, FHECounter__factory } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm as mockFhevm } from "hardhat";
import { createInstance, loadTestnetConfig, loadWallet, timestampLog } from "../tasks/utils";
import { JsonRpcProvider, HDNodeWallet, Signer } from "ethers";
import { FhevmInstance } from "@zama-fhe/relayer-sdk/node";
import { HardhatFhevmRuntimeEnvironment, FhevmType } from "@fhevm/hardhat-plugin";


type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const keyFile = "key.json";
  const networkName = process.env.NETWORK || "hardhat";
  let wallet: HDNodeWallet;
  let contractFactory: FHECounter__factory;
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
    contractFactory = new FHECounter__factory(wallet);
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
    contractFactory = await ethers.getContractFactory("FHECounter") as unknown as FHECounter__factory;
    timestampLog("Using mock fhevm");
    fhevm = mockFhevm;
  }

  timestampLog("Deploying contract")
  const fheCounterContract = await contractFactory.deploy(
    ethers.getAddress(testnetConfig.aclContractAddress),
    ethers.getAddress(testnetConfig.fhevmExecutorContractAddress),
    ethers.getAddress(testnetConfig.kmsVerifierContractAddress),
    ethers.getAddress(testnetConfig.decryptionOracleContractAddress),
  );
  timestampLog("Waiting for deployment...")
  const receipt = await (await fheCounterContract.waitForDeployment()).deploymentTransaction()?.wait()
  timestampLog("Contract deployed at block: " + receipt?.blockNumber);
  const fheCounterContractAddress = receipt?.contractAddress as string;
  timestampLog("Contract address: " + fheCounterContractAddress)


  return { fheCounterContract, fheCounterContractAddress, wallet, walletAddress, fhevm };
}

async function setupUserDecrypt(instance: FhevmInstance, signer: HDNodeWallet, ciphertextHandle: string, contractAddress: string): Promise<string | bigint | boolean> {
  // instance: [`FhevmInstance`] from `zama-fhe/relayer-sdk`
  // signer: [`Signer`] from ethers (could a [`Wallet`])
  // ciphertextHandle: [`string`]
  // contractAddress: [`string`]

  timestampLog("Generating keypair...")

  const keypair = instance.generateKeypair();
  const handleContractPairs = [
    {
      handle: ciphertextHandle,
      contractAddress: contractAddress,
    },
  ];
  const startTimeStamp = Math.floor(Date.now() / 1000).toString();
  const durationDays = '10'; // String for consistency
  const contractAddresses = [contractAddress];

  timestampLog("Creating EIP712...")
  const eip712 = instance.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimeStamp,
    durationDays,
  );

  timestampLog("Sign typed data...")

  const signature = await signer.signTypedData(
    eip712.domain,
    {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
    },
    eip712.message,
  );

  timestampLog("User decrypt...")

  const result = await instance.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace('0x', ''),
    contractAddresses,
    signer.address,
    startTimeStamp,
    durationDays,
  );
  console.log(result);

  const decryptedValue = result[ciphertextHandle];
  timestampLog("Result: " + decryptedValue);
  return decryptedValue;
}

describe("FHECounter", function () {
  let signers: Signers;
  let fheCounterContract: FHECounter;
  let fheCounterContractAddress: string;
  let wallet: HDNodeWallet;
  let fhevm: HardhatFhevmRuntimeEnvironment;
  let walletAddress: string;


  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
    console.log("Alice address: "+signers.alice.address);
  });

  beforeEach(async () => {
    ({ fheCounterContract, fheCounterContractAddress, wallet, walletAddress, fhevm } = await deployFixture());
  });

/*   it("encrypted count should be uninitialized after deployment", async function () {
    const encryptedCount = await fheCounterContract.getCount();
    // Expect initial count to be bytes32(0) after deployment,
    // (meaning the encrypted count value is uninitialized)
    expect(encryptedCount).to.eq(ethers.ZeroHash);
  }); */

  it("increment the counter by 1", async function () {
    const encryptedCountBeforeInc = await fheCounterContract.getCount();
    expect(encryptedCountBeforeInc).to.eq(ethers.ZeroHash);
    const clearCountBeforeInc = 0;

    // Encrypt constant 1 as a euint32
    const clearOne = 1;
    const encryptedOne = await fhevm
      .createEncryptedInput(fheCounterContractAddress, signers.alice.address)
      .add32(clearOne)
      .encrypt();

    const tx = await fheCounterContract
      .connect(signers.alice)
      .increment(encryptedOne.handles[0], encryptedOne.inputProof);
    await tx.wait();

    const encryptedCountAfterInc = await fheCounterContract.getCount();

    if (fhevm.isMock) {
      const clearCountAfterInc = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encryptedCountAfterInc,
        fheCounterContractAddress,
        signers.alice,
      );
      expect(clearCountAfterInc).to.eq(clearCountBeforeInc + clearOne);
    }
  }).timeout(4 * 60 * 1000);

  it("decrement the counter by 1", async function () {
    // Encrypt constant 1 as a euint32
    const clearOne = 1;
    const encryptedOne = await fhevm
      .createEncryptedInput(fheCounterContractAddress, signers.alice.address)
      .add32(clearOne)
      .encrypt();

    // First increment by 1, count becomes 1
    let tx = await fheCounterContract
      .connect(signers.alice)
      .increment(encryptedOne.handles[0], encryptedOne.inputProof);
    await tx.wait();

    // Then decrement by 1, count goes back to 0
    tx = await fheCounterContract.connect(signers.alice).decrement(encryptedOne.handles[0], encryptedOne.inputProof);
    await tx.wait();

    const encryptedCountAfterDec = await fheCounterContract.getCount();
    if (fhevm.isMock) {
      const clearCountAfterDec = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encryptedCountAfterDec,
        fheCounterContractAddress,
        signers.alice,
      );
      expect(clearCountAfterDec).to.eq(0);
    }
  }).timeout(8 * 60 * 1000);
});