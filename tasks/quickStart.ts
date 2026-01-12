import * as fs from "fs";
import { task } from 'hardhat/config';
import { createInstance, timestampLog, loadWallet, loadTestnetConfig } from "./utils";
import { Test__factory as TestFactory } from "../typechain-types/factories/contracts/Simple.sol/Test__factory";
import { Test as TestContract } from "../typechain-types/contracts/Simple.sol/Test";
import { ethers } from "ethers";
import readline from 'readline/promises';
// import readline from 'node:readline';
// import { ReadStream } from "fs";
import createPrompt from 'prompt-sync';
import { waitForDebugger } from "inspector";
import path from "path";

const UINT4_MAX = 127;


let spinnerDots = {
    interval: 80,
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

const startSpinner = (message: string): NodeJS.Timeout => {
    let currFrameNum = 0;
    let currFrame = spinnerDots.frames[currFrameNum];
    process.stdout.write(message);
    return setInterval(() => {
        process.stdout.moveCursor(-1, 0);
        process.stdout.write(currFrame);
        currFrameNum = (currFrameNum + 1) % (spinnerDots.frames.length);
        currFrame = spinnerDots.frames[currFrameNum];
    }, spinnerDots.interval);
}

const stopSpinner = (message: string, timeoutRef: NodeJS.Timeout) => {
    clearInterval(timeoutRef);
    process.stdout.moveCursor(-1, 0);
    process.stdout.write(message + "\n");
}

const keyDir = "./keys/";
const inputFile = "encrypted_inputs.json"
const TESTNET_DEV_CONFIG_FILE = "networks/dev.json";
const TESTNET_BLUE_CONFIG_FILE = "networks/blue.json"
let wallet: ethers.Wallet | ethers.HDNodeWallet;

function hasFilesWithExtension(dirPath: string, extension: string): boolean {
    if (!fs.existsSync(dirPath)) return false;
    if (!fs.statSync(dirPath).isDirectory()) return false;
    const files = fs.readdirSync(dirPath)
        .filter(file => path.extname(file) === extension);
    return files.length > 0;
}

enum TestnetNetwork {
    DEV = "dev",
    BLUE = "blue"
}



// hre is included to call external tasks
task('quickStart')
    .setAction(async (_, hre) => {
        let keyFile = '';
        let configFile = TESTNET_DEV_CONFIG_FILE;
        let contractAddressFile = 'test_contract.address';


        // Read keys from the /keys directory and provide the user 
        // with options, including generating a new key
        const keys = fs.readdirSync("./keys/").filter(name => {
            return name.includes(".json");
        });
        let rl = readline.createInterface(
            process.stdin,
            process.stdout, (line: string) => {
                const hits = keys.filter(o => o.startsWith(line));
                return [hits.length ? hits : keys, line];
            }
        );
        keyFile = await rl.question(
            `What is the name of your key file? (${keys.join(" / ")}). \nIf you want to generate a new key, type the name of the output file. \n(Press tab to autocomplete)\n: `);
        const keyPath = path.join(keyDir, keyFile);
        console.log(`The name of your key file is ${keyFile}, the path of your key file is ${keyPath}`);

        // Create new wallet if necessary
        // Exits if the wallet is new, since it does not have funds
        if (!fs.existsSync(keyPath)) {
            await hre.run("task:accountCreate", { keyFile: keyPath });
            timestampLog("Please request funds from Optalysys to this address before proceeding using the account number provided");
            process.exit(1);
        }


        // Set up WALLET_PASSWORD
        let password = process.env.WALLET_PASSWORD;
        if (!password) {
            console.log("Environment variable WALLET_PASSWORD has not been set");
            let passwordSetQ = await rl.question('Do you want to set WALLET_PASSWORD env var to skip the password prompt? (y / n): ');
            passwordSetQ = passwordSetQ.trim().toLowerCase();
            if (passwordSetQ === "y" || passwordSetQ === "yes") {
                password = createPrompt({ sigint: true }).hide('Enter password for wallet: ');
                process.env.WALLET_PASSWORD = password;
            }
        }

        configFile = TESTNET_BLUE_CONFIG_FILE;

        // Load wallet
        timestampLog(`Reading wallet from file: ${keyPath}`);
        wallet = await loadWallet(keyPath);
        const walletAddress = wallet.address;
        timestampLog("Your wallet address is: " + walletAddress);

        // Loading testnet config
        timestampLog("Loading testnet config")
        const testnetConfig = await loadTestnetConfig(configFile)
        timestampLog("Connecting provider")

        // Check whether wallet has enough balance
        const provider = ethers.getDefaultProvider(testnetConfig.jsonRpcUrl);
        timestampLog("Requesting balance");
        const balance = await provider.getBalance(walletAddress);
        const formattedBalance = ethers.formatEther(balance);
        if (balance < 10 * (10 ** 9)) { // 10 GWEI
            timestampLog(`You don't have enough ETH to deploy! Wallet balance: ${formattedBalance} ETH. Please request funds from Optalysys for wallet address ${walletAddress}`);
            process.exit(1);
        }
        timestampLog(`Balance for wallet ${walletAddress}: ${formattedBalance} ETH`);
        rl.close();

        let deployNewContract = false;
        const contractAddressesDir = "./contract_addresses";
        // Read deployed contracts from the ./contract_addresses directory
        const contractAddressFiles = fs.readdirSync("./contract_addresses/").filter(file => path.extname(file) === ".address");


        if (hasFilesWithExtension(contractAddressesDir, ".address")) {
            timestampLog(`Already deployed contracts in ${contractAddressesDir}: ${contractAddressFiles.join(", ")}`);
            rl = readline.createInterface(
                process.stdin,
                process.stdout
            );
            let userDeployNewContract = await rl.question("Do you want to deploy a new instance of the contract? (y / n): ");
            rl.close();
            userDeployNewContract = userDeployNewContract.trim().toLowerCase();
            if (userDeployNewContract === "y" || userDeployNewContract === "yes") {
                deployNewContract = true;
            }
        } else {
            timestampLog(`No contracts found in directory ${contractAddressesDir}.`);
            deployNewContract = true;
        }


        rl = readline.createInterface(
            process.stdin,
            process.stdout, (line: string) => {
                const hits = contractAddressFiles.filter(o => o.startsWith(line));
                return [hits.length ? hits : contractAddressFiles, line];
            }
        );
        contractAddressFile = await rl.question(`What is the filename to load/save the deployed contract address? (e.g. file_name.address): `);
        rl.close();
        const contractAddressPath = path.join(contractAddressesDir, contractAddressFile);
        console.log(`The name of your contract address file is ${contractAddressFile}, the path of your contract address file is ${contractAddressPath}`);
        if (deployNewContract) {
            // Deploy smart contract
            timestampLog(`Deploying contract`);
            await hre.run("task:deployTest", { configFile: configFile, addressFile: contractAddressPath, keyFile: keyPath });
        }

        timestampLog("Loading contract address")
        const contractAddress = await fs.promises.readFile(contractAddressPath, 'utf8')


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
        );

        timestampLog("Collecting inputs a and b for storeEncryptedSum...");

        rl = readline.createInterface(
            process.stdin,
            process.stdout
        );
        let input1: Number | undefined = undefined, input2: Number | undefined = undefined;
        while (input1 === undefined) {
            const userInput1 = await rl.question('Pick an integer in the interval (0, 127) for a: ');
            const userInput1Parsed = Number.parseInt(userInput1.trim());
            if (userInput1Parsed > 127 || userInput1Parsed < 0) {
                console.log("ERROR: Please enter an integer in the range (0, 127)!");
            } else {
                input1 = userInput1Parsed;
            }

        }
        while (input2 === undefined) {
            const userInput2 = await rl.question('Pick an integer in the interval (0, 127) for b: ');
            const userInput2Parsed = Number.parseInt(userInput2.trim());
            if (userInput2Parsed > 127 || userInput2Parsed < 0) {
                console.log("ERROR: Please enter an integer in the range (0, 127)!");
            } else {
                input2 = userInput2Parsed;
            }

        }
        timestampLog("Encrypting... ")
        console.time("zkProof");
        const encryptionSpinner = startSpinner("Please wait for encryption...  ");
        const encryptedInput = await (fhevmInstance.createEncryptedInput(contractAddress, wallet.address)
            .add8(Number(input1))
            .add8(Number(input2)).encrypt())
        stopSpinner("DONE!", encryptionSpinner);
        timestampLog("Input encrypted")
        fs.writeFileSync(
            inputFile,
            JSON.stringify(
                encryptedInput,
                (_, value) => {
                    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
                        return Buffer.from(value).toJSON()
                    }
                    return value
                }
            )
        )
        timestampLog("Encrypted input and ZK proof written to: " + inputFile)

        console.timeEnd("zkProof");

        timestampLog("Connecting wallet")
        const connectedWallet = wallet.connect(ethers.getDefaultProvider(testnetConfig.jsonRpcUrl))

        timestampLog("Connecting to contract")
        const contract = new TestFactory(connectedWallet).attach(contractAddress) as TestContract
        timestampLog("Calling storeEncryptedSimpleValue on contract")
        const txResponse = await contract.storeEncryptedSum(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof)
        timestampLog("Transaction hash: " + txResponse.hash)
        timestampLog("Waiting for transaction to be included in block...")
        const txSpinner = startSpinner("Please wait for transaction...  ");
        const txReceipt = await txResponse.wait()
        stopSpinner("DONE!", txSpinner);
        timestampLog("Transaction receipt received. Block number: " + txReceipt?.blockNumber)


        timestampLog("Getting ciphertext handle")
        const handles = [await contract.encryptedSum()];
        timestampLog("Requesting decryption...")
        const decryptionSpinner = startSpinner("Please wait for decryption...  ");
        const result = await fhevmInstance.publicDecrypt(handles)
        stopSpinner("DONE!", decryptionSpinner);
        timestampLog("Result:")
        for (const key in result) {
            console.log(key, result[key])
        }
        rl.close();
    });


task('benchmarkSum')
    .setAction(async (_, hre) => {
        timestampLog("Benchmarking storeEncryptedSum...");
        let keyFile = '';
        let configFile = TESTNET_BLUE_CONFIG_FILE;
        let contractAddressFile = 'test_contract.address';

        // Read keys from the /keys directory and provide the user 
        // with options, including generating a new key
        const keys = fs.readdirSync("./keys/").filter(name => {
            return name.includes(".json");
        });
        let rl = readline.createInterface(
            process.stdin,
            process.stdout, (line: string) => {
                const hits = keys.filter(o => o.startsWith(line));
                return [hits.length ? hits : keys, line];
            }
        );
        keyFile = await rl.question(
            `What is the name of your key file? (${keys.join(" / ")}). \nIf you want to generate a new key, type the name of the output file. \n(Press tab to autocomplete)\n: `);
        const keyPath = path.join(keyDir, keyFile);
        console.log(`The name of your key file is ${keyFile}, the path of your key file is ${keyPath}`);

        // Create new wallet if necessary
        // Exits if the wallet is new, since it does not have funds
        if (!fs.existsSync(keyPath)) {
            await hre.run("task:accountCreate", { keyFile: keyPath });
            timestampLog("Please request funds from Optalysys to this address before proceeding using the account number provided");
            process.exit(1);
        }

        // Load wallet
        timestampLog(`Reading wallet from file: ${keyPath}`);
        wallet = await loadWallet(keyPath);
        const walletAddress = wallet.address;
        timestampLog("Your wallet address is: " + walletAddress);

        // Loading testnet config
        timestampLog("Loading testnet config")
        const testnetConfig = await loadTestnetConfig(configFile)
        timestampLog("Connecting provider")

        // Check whether wallet has enough balance
        const provider = ethers.getDefaultProvider(testnetConfig.jsonRpcUrl);
        timestampLog("Requesting balance");
        const balance = await provider.getBalance(walletAddress);
        const formattedBalance = ethers.formatEther(balance);
        if (balance < 10 * (10 ** 9)) { // 10 GWEI
            timestampLog(`You don't have enough ETH to deploy! Wallet balance: ${formattedBalance} ETH. Please request funds from Optalysys for wallet address ${walletAddress}`);
            process.exit(1);
        }
        timestampLog(`Balance for wallet ${walletAddress}: ${formattedBalance} ETH`);
        rl.close();

        let deployNewContract = false;
        const contractAddressesDir = "./contract_addresses";
        // Read deployed contracts from the ./contract_addresses directory
        const contractAddressFiles = fs.readdirSync("./contract_addresses/").filter(file => path.extname(file) === ".address");


        if (hasFilesWithExtension(contractAddressesDir, ".address")) {
            timestampLog(`Already deployed contracts in ${contractAddressesDir}: ${contractAddressFiles.join(", ")}`);
            rl = readline.createInterface(
                process.stdin,
                process.stdout
            );
            let userDeployNewContract = await rl.question("Do you want to deploy a new instance of the contract? (y / n): ");
            rl.close();
            userDeployNewContract = userDeployNewContract.trim().toLowerCase();
            if (userDeployNewContract === "y" || userDeployNewContract === "yes") {
                deployNewContract = true;
            }
        } else {
            timestampLog(`No contracts found in directory ${contractAddressesDir}.`);
            deployNewContract = true;
        }


        rl = readline.createInterface(
            process.stdin,
            process.stdout, (line: string) => {
                const hits = contractAddressFiles.filter(o => o.startsWith(line));
                return [hits.length ? hits : contractAddressFiles, line];
            }
        );
        contractAddressFile = await rl.question(`What is the filename to load/save the deployed contract address? (e.g. file_name.address): `);
        rl.close();
        const contractAddressPath = path.join(contractAddressesDir, contractAddressFile);
        console.log(`The name of your contract address file is ${contractAddressFile}, the path of your contract address file is ${contractAddressPath}`);
        if (deployNewContract) {
            // Deploy smart contract
            timestampLog(`Deploying contract`);
            await hre.run("task:deployTest", { configFile: configFile, addressFile: contractAddressPath, keyFile: keyPath });
        }

        timestampLog("Loading contract address")
        const contractAddress = await fs.promises.readFile(contractAddressPath, 'utf8')

        rl = readline.createInterface(
            process.stdin,
            process.stdout
        );
        let numTimes: Number | undefined = undefined;
        const MAX_TIMES = 100;
        while (numTimes === undefined) {
            const userInput = await rl.question('The number of times to run encryptedSum (between 1 and 100): ');
            const userInputParsed = Number.parseInt(userInput.trim());
            if (userInputParsed > MAX_TIMES || userInputParsed < 1) {
                console.log("ERROR: Please enter an integer in the range (0, 100)!");
            } else {
                numTimes = userInputParsed;
            }
        }
        timestampLog(`You have entered ${numTimes}. Generating ${numTimes} random integers each for the values of a and b...`);
        let aValues = [...new Array(numTimes)].map(_ => Math.floor(Math.random() * (UINT4_MAX + 1)));
        let bValues = [...new Array(numTimes)].map(_ => Math.floor(Math.random() * (UINT4_MAX + 1)));
        const abZipped = aValues.map((val, i) => [val, bValues[i]]);
        timestampLog("Generated random a+b values:");
        console.log(abZipped);

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
        );

        let runBenchmark = true;
        rl.on('SIGINT', () => {
            console.log();
            timestampLog("benchmarking interrupted, waiting until current iteration completes...");
            runBenchmark = false;
        });

        timestampLog("Running benchmark...");
        console.time("benchmarkAdd");

        let i = 0;

        while (i < abZipped.length) {
            if (!runBenchmark) {
                timestampLog(`benchmarking truncated after ${i} times`);
                break;
            }
            const a = abZipped[i][0];
            const b = abZipped[i][1];

            timestampLog(`Running benchmark iteration ${i + 1}:`);


            timestampLog("Encrypting... ")
            console.time(`zkProof${i + 1}`);
            const encryptionSpinner = startSpinner("Please wait for encryption...  ");
            const encryptedInput = await (fhevmInstance.createEncryptedInput(contractAddress, wallet.address)
                .add8(Number(a))
                .add8(Number(b)).encrypt())
            stopSpinner("DONE!", encryptionSpinner);
            timestampLog("Input encrypted")
            fs.writeFileSync(
                inputFile,
                JSON.stringify(
                    encryptedInput,
                    (_, value) => {
                        if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
                            return Buffer.from(value).toJSON()
                        }
                        return value
                    }
                )
            )
            timestampLog("Encrypted input and ZK proof written to: " + inputFile)

            console.timeEnd(`zkProof${i + 1}`);

            timestampLog("Connecting wallet")
            const connectedWallet = wallet.connect(ethers.getDefaultProvider(testnetConfig.jsonRpcUrl))

            timestampLog("Connecting to contract")
            const contract = new TestFactory(connectedWallet).attach(contractAddress) as TestContract
            timestampLog("Calling storeEncryptedSimpleValue on contract")
            const txResponse = await contract.storeEncryptedSum(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof)
            timestampLog("Transaction hash: " + txResponse.hash)
            timestampLog("Waiting for transaction to be included in block...")
            const txSpinner = startSpinner("Please wait for transaction...  ");
            const txReceipt = await txResponse.wait()
            stopSpinner("DONE!", txSpinner);
            timestampLog("Transaction receipt received. Block number: " + txReceipt?.blockNumber);
            i++;
        }
        rl.close();
        timestampLog(`Benchmark time for ${i} iterations of encryptedSum:`);
        console.timeEnd("benchmarkAdd");
    });