import * as fs from "fs"
import { task } from 'hardhat/config';
import type { TaskArguments } from 'hardhat/types';
import { createInstance, timestampLog, loadWallet, loadTestnetConfig } from "./utils"
import { Test__factory as TestFactory } from "../typechain-types/factories/contracts/Simple.sol/Test__factory"
import { Test as TestContract } from "../typechain-types/contracts/Simple.sol/Test"

task('task:encryptSumInputs')
    .addParam('input1', 'Input 1 to encrypt')
    .addParam('input2', 'Input 1 to encrypt')
    .addParam('inputFile', 'File to write encrypted inputs and zkproof to')
    .addParam('configFile', 'JSON file to read testnet config from')
    .addParam('addressFile', 'File to read address of deployed contract from')
    .addParam('keyFile', 'Encrypted key to derive user address from')
    .setAction(async function (taskArguments: TaskArguments) {
        timestampLog("Loading wallet")
        const wallet = await loadWallet(taskArguments.keyFile)
        timestampLog("Loading contract address")
        const contractAddress = await fs.promises.readFile(taskArguments.addressFile, 'utf8')
        timestampLog("Loading testnet config")
        const testnetConfig = await loadTestnetConfig(taskArguments.configFile)
        timestampLog("Instantiating fhevm instance")
        const fhevmInstance = await createInstance(
            testnetConfig.decryptionContractAddress,
            testnetConfig.inputVerificationContractAddress,
            testnetConfig.inputVerifierContractAddress,
            testnetConfig.kmsVerifierContractAddress,
            testnetConfig.aclContractAddress,
            testnetConfig.gatewayChainId,
            testnetConfig.relayerUrl,
            testnetConfig.jsonRpcUrl,
        )
        timestampLog("Encrypting...")
        const encryptedInput = await (fhevmInstance.createEncryptedInput(contractAddress, wallet.address)
            .add8(Number(taskArguments.input1))
            .add8(Number(taskArguments.input2)).encrypt())
        timestampLog("Input encrypted")
        fs.writeFileSync(
            taskArguments.inputFile,
            JSON.stringify(
                encryptedInput,
                (_, value) => {
                    if(value instanceof Uint8Array || Buffer.isBuffer(value)){
                        return Buffer.from(value).toJSON()
                    }
                    return value
                }
            )
        )
        timestampLog("Encrypted input and ZK proof written to: " + taskArguments.inputFile)
    })

task('task:storeEncryptedSum')
    .addParam('inputFile', 'File to read encrypted inputs and zkproof from')
    .addParam('configFile', 'JSON file to read testnet config from')
    .addParam('addressFile', 'File to read address of deployed contract from')
    .addParam('keyFile', 'Encrypted key to derive user address from')
    .setAction(async function (taskArguments: TaskArguments, { ethers }) {
        timestampLog("Loading wallet")
        const wallet = await loadWallet(taskArguments.keyFile)
        timestampLog("Loading contract address")
        const contractAddress = await fs.promises.readFile(taskArguments.addressFile, 'utf8')
        timestampLog("Loading testnet config")
        const testnetConfig = await loadTestnetConfig(taskArguments.configFile)
        timestampLog("Loading encrypted inputs and zkproof")
        const encryptedInput = JSON.parse(
            new String(fs.readFileSync(taskArguments.inputFile)).toString(),
            (_, value) => {
            if (typeof value == "object" && 'type' in value && value.type == "Buffer") {
                return new Uint8Array(value.data)
            }
            return value
            }
        ) as {handles: Uint8Array<ArrayBufferLike>[]; inputProof: Uint8Array}
        timestampLog("Connecting wallet")
        const connectedWallet = wallet.connect(ethers.getDefaultProvider(testnetConfig.jsonRpcUrl))
        timestampLog("Connecting to contract")
        const contract = new TestFactory(connectedWallet).attach(contractAddress) as TestContract
        timestampLog("Calling storeEncryptedSum on contract")
        const txResponse = await contract.storeEncryptedSum(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof)
        timestampLog("Transaction hash: " + txResponse.hash)
        timestampLog("Waiting for transaction to be included in block...")
        const txReceipt = await txResponse.wait()
        timestampLog("Transaction receipt received. Block number: " + txReceipt?.blockNumber)
    })

task('task:publicDecryptionOfSum')
    .addParam('configFile', 'JSON file to read testnet config from')
    .addParam('addressFile', 'File to read address of deployed contract from')
    .setAction(async function (taskArguments: TaskArguments, { ethers }) {
        timestampLog("Loading wallet")
        timestampLog("Loading contract address")
        const contractAddress = await fs.promises.readFile(taskArguments.addressFile, 'utf8')
        timestampLog("Loading testnet config")
        const testnetConfig = await loadTestnetConfig(taskArguments.configFile)
        timestampLog("Instantiating fhevm instance")
        const fhevmInstance = await createInstance(
            testnetConfig.decryptionContractAddress,
            testnetConfig.inputVerificationContractAddress,
            testnetConfig.inputVerifierContractAddress,
            testnetConfig.kmsVerifierContractAddress,
            testnetConfig.aclContractAddress,
            testnetConfig.gatewayChainId,
            testnetConfig.relayerUrl,
            testnetConfig.jsonRpcUrl,
        )
        timestampLog("Connecting provider")
        const provider = ethers.getDefaultProvider(testnetConfig.jsonRpcUrl)
        timestampLog("Connecting to contract")
        const contract = new ethers.Contract(contractAddress, TestFactory.abi, provider) as unknown as TestContract
        timestampLog("Getting ciphertext handle")
        const handles = [await contract.encryptedSum()];
        timestampLog("Requesting decryption...")
        const result = await fhevmInstance.publicDecrypt(handles)
        timestampLog("Result:")
        for (const key in result) {
            console.log(key, result[key])
        }
    })
