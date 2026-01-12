# User Instructions for Optalysys Testnet

## Quick Guide

> If you already familiar with interacting with Ethereum blockchains using the JSON RPC API, writing smart contracts in Solidity and writing javascript or typescript you can get started with the below. Otherwise see the [detailed guide](#detailed-guide).

1. Generate an Ethereum compatible private key.
2. Give Optalysys the address derived from your private key and request testnet Eth to be allocated.
3. Request the JSON RPC URL, relayer URL, gateway chain ID, ACL contract address, FHEVM executor contract address, KMS verifier contract address, decryption oracle contract address, input verifier contract address, input verification contract address and decryption contract address from Optalysys.
4. Write an FHE smart contract using [Zama's Solidity docs](https://docs.zama.ai/protocol/solidity-guides/smart-contract/configure) (but with **config explicitly set to use the addresses provided by Optalysys, not Zama's config for Sepolia** - as the addresses are of course different). Use [Zama's Solidity library](https://www.npmjs.com/package/@fhevm/solidity) at version v0.8.0 (other versions may work, but currently the server side of Optalysys' testnet uses versions of Zama's stack known to be compatible with v0.8.0).
5. Deploy your smart contract using your method of choice through the JSON RPC URL provided by Optalysys in step 3 using you private key that was funded in step 2 to sign the transaction. See the [Ethereum documentation on deploying smart contracts](https://ethereum.org/developers/docs/smart-contracts/deploying/) if you don't know how to do this.
6. Interact with your contract using your method of choice and create encrypted inputs to send to it / request decryptions using [Zama's relayer SDK](https://www.npmjs.com/package/@zama-fhe/relayer-sdk) at version v0.2.0 (other versions may work, but the current version of Zama's relayer run on Optalysys' testnet is known to be compatible with v0.2.0) - using the details provided by Optalysys in step 3 to initialise the relayer SDK.

## Detailed Guide

> All commands in this guide assume you are running them from the directory in which this guide exists on your machine.
### Pre-requisites

#### `pnpm` package manager

This guide uses [pnpm](https://pnpm.io/installation). If you already have this installed on your machine or know how to run a container with them installed you can skip this section.

#### Docker
It is recommended to run this guide in a container, to avoid the [it works on my machine issue](https://expertbeacon.com/the-works-on-my-machine-problem-causes-solutions-and-lessons-from-google/).

> This guide uses Docker, but you can use another container management tool if you wish (e.g. podman). If you choose to use Docker, follow the instructions for [installing Docker on your machine](https://docs.docker.com/engine/install/). Alternatively, you may install `pnpm` directly on your machine.

The folder contains a `Dockerfile` containing instructions to build a Ubuntu Docker container with `node` and `pnpm`.

> If your company uses a proxy, you will need to [add their CA certificates to the Dockerfile](https://docs.docker.com/engine/network/ca-certs/#add-ca-certificates-to-linux-images-and-containers) to ensure commands like `apt` and `pnpm install` work. The commented-out sections in the `Dockerfile` have an example of this.
### Running Docker

After Docker has been installed, you can start an Ubuntu container by typing the following.
```bash
./start.sh
```
This runs the command below, building the `Dockerfile` and tags it `testnet-pnpm-ubuntu`, and then running the Docker container.
```bash
docker build -t testnet-pnpm-ubuntu . && docker run --hostname testnet-pnpm-ubuntu -it --rm -v .:/home/node/guide --workdir /home/node/guide testnet-pnpm-ubuntu bash
```

The following commands will be run inside the Docker container. Make sure the shell prompt shows `node@testnet-pnpm-ubuntu:~/guide$` which means you are running the Docker container's shell.

### Install Dependencies

Install the dependencies for the code used in this guide
```bash
pnpm install
```
> If you're interested only in simply evaluating the performance of either testnet, you may skip the rest of this section and go directly to [[#The `quickStart` task a simple way to interact with Optalysys testnets]].

### Generate an Ethereum Compatible Private Key

- **Either** [generate a new Ethereum compatible private key](#generate-a-new-ethereum-compatible-private-key)
- **Or** [import an existing Ethereum compatible private key](#import-an-existing-ethereum-compatible-private-key)

Your wallet will persist in the private key JSON file.

#### Generate a new Ethereum compatible private key

> Enter a password when prompted, or set the `WALLET_PASSWORD` env var

```bash
pnpm hardhat task:accountCreate --key-file key.json
```

> You can output the decrypted private key with `pnpm hardhat task:accountPrintPrivateKey --key-file key.json` - beware that printing it to your terminal is not recommended.

#### Import an existing Ethereum compatible private key

Set the environment variable `PRIVATE_KEY` to your private key.

> Enter a password when prompted, or set the `WALLET_PASSWORD` env var

```bash
pnpm hardhat task:accountImport --key-file key.json
```

### Check your wallet ETH balance on the testnet

```bash
pnpm hardhat task:getBalance --key-file key.json --config-file testnet_config.json 
2025-10-24T14:03:35.875Z :: Loading wallet
Set WALLET_PASSWORD env var to skip this prompt
Enter password for wallet: 
2025-10-24T14:03:39.070Z :: Loading testnet config
2025-10-24T14:03:39.072Z :: Connecting provider
2025-10-24T14:03:39.094Z :: Requesting balance
2025-10-24T14:03:39.316Z :: Balance for wallet 0x7Cc412E67f88ba0CBC6F5C28279E4e5c79c2aEd9: 0.999997600761205446 ETH
```

### Request funds and details on the testnet from Optalysys

Get the address from your private key

```bash
pnpm hardhat task:accountPrintAddress --key-file key.json
```

Send this to Optalysys requesting funds on the testnet.

**You will not be able to interact with contracts on the testnet without funds**

> Once you have the above you can start deploying smart contracts to the testnet that use FHE and interacting with them. The rest of this guide walks through deploying a simple test contract and interacting with it.

### Deploy a Simple Contract

The hardhat tasks (prefixed by `task:`) are defined in the folder `tasks/`. The network config file are the config details to connect to the testnet, so there's no need to pass the `--network` param to hardhat (anyway, hardhat doesn't support custom network names).

This deploys a simple contract to the testnet using the account and config you created in the previous steps. The contract is in the file `contracts/Simple.sol`. It demonstrates encrypting a uint8, and two uint8s, and public decryption. The deployed contract address is written to the file `test_contract.address`.

```bash
pnpm hardhat task:deployTest --config-file testnet_config.json --address-file test_contract.address --key-file key.json
```

### Store an Encrypted Value on the Contract then Request Its Decryption

As a first test we will encrypt an unsigned 8-bit integer, store it on the contract, then request its decryption.

#### Encrypt an Unsigned 8-bit Integer 

This will fetch the URLs of the public keys from the relayer, then fetch the public keys from those URLs, use the public key to encrypt the input and then generate a zero-knowledge proof that we know the plaintext value for this ciphertext. The ciphertext and zkproof will be stored in a file `encrypted_input.json` so we can use them in following steps.

```bash
pnpm hardhat task:encryptUint8 --input 7 --input-file encrypted_input.json --config-file testnet_config.json --address-file test_contract.address --key-file key.json
```

#### Store Encrypted Value on Contract

Now that the coprocessors know about the ciphertext (from the previous action) and have returned an attestation of the zkproof, we can store the ciphertext (actually a "handle" that the coprocessors know references that ciphertext) from `encrypted_input.json` on our contract on the blockchain.

```bash
pnpm hardhat task:storeEncryptedUint8 --input-file encrypted_input.json --config-file testnet_config.json --address-file test_contract.address --key-file key.json
```

#### Request Public Decryption

Now that a reference to the ciphertext is stored on the blockchain, ACLs have been created that control who can interact with that ciphertext. If you [look at the contract code](./contracts/Simple.sol) you will see that we allow public decryption of the ciphertext we just stored. In a real scenario this could be used for revealing the winner of a blind auction (for example). See [Zama's docs](https://docs.zama.ai/protocol/relayer-sdk-guides/fhevm-relayer/decryption/public-decryption) for more details about public decryption. Lets use public decryption to get the plaintext of the value stored on the blockchain.

> The output should match the input provided in the earlier step when encrypting.

```bash
pnpm hardhat task:publicDecryptionOfSimpleUint8 --config-file testnet_config.json --address-file test_contract.address
```

### Perform FHE Compute on the Blockchain and Request Result's Decryption

The previous test confirmed that we can fetch the public keys, use them to encrypt a value, generate a zkproof of plaintext knowledge, get an attestation of our zkproof, store a reference to a ciphertext on a contract on the blockchain and then request it to be decrypted later.

Now we will perform FHE compute on the blockchain.

#### Encrypt 2 Unsigned 8-bit Integers 

The first step is the same as before, but since we will be sending 2 encrypted values (inputs to sum under FHE) we need to encrypt them both. Fortunately generating the zkproof and getting the attestation takes a similar time as they can be submitted in a bundle together. The encrypted inputs are written to the file `encrypted_sum_inputs.json`.

```bash
pnpm hardhat task:encryptSumInputs --input1 3 --input2 5 --input-file encrypted_sum_inputs.json --config-file testnet_config.json --address-file test_contract.address --key-file key.json
```

#### Request Encrypted Sum to be Stored on Contract

Now that the coprocessors know about the ciphertexts (from the previous action) and have returned an attestation of the zkproof, we can send the ciphertexts (actually a "handle" that the coprocessors know references that ciphertext) read from `encrypted_sum_inputs.json` to our contract on the blockchain, calling a method that performs FHE compute to sum the 2 ciphertexts and stores the encrypted sum on the contract.

On-chain the compute is done symbolically, and from the input handles and operations a new handle is deterministically calculated. The core FHE contracts that our contract uses then emit an event for each FHE operation which is seen by the coprocessors. The coprocessors then perform the actual FHE compute, making the result ciphertexts available for further calculation/decryption.

```bash
pnpm hardhat task:requestEncryptedSum --input-file encrypted_sum_inputs.json --config-file testnet_config.json --address-file test_contract.address --key-file key.json
```

#### Request Public Decryption

Now that a reference to the resultant (sum) ciphertext is stored on the blockchain, ACLs have been created that control who can interact with that ciphertext. If you [look at the contract code](./contracts/Simple.sol) you will see that we allow public decryption of the resultant ciphertext. In a real scenario this could be used for revealing the winner of a blind auction (for example). See [Zama's docs](https://docs.zama.ai/protocol/relayer-sdk-guides/fhevm-relayer/decryption/public-decryption) for more details about public decryption. Lets use public decryption to get the plaintext of the value stored on the blockchain.

> Since the actual FHE compute happens asynchronously the ciphertext may not be available yet. If the ciphertext takes too long to be available then this will time out, but it can just be rerun to re-request the decryption.

> The output should match the sum of the inputs provided in the earlier step when encrypting.

```bash
pnpm hardhat task:publicDecryptionOfSum --config-file testnet_config.json --address-file test_contract.address
```

## The `quickStart` task: a  simple way to interact with Optalysys testnets
The following command allows you to easily interact with the testnets with the `Simple.sol` smart contract. To run this command, it is assumed that you have already [[BB -- User Instructions#Install Dependencies]].

```bash
pnpm hardhat quickStart
```

The previous command will prompt you to provide the name of your key file. It will search in the `keys` directory for existing keys.

```bash
node@testnet-pnpm-ubuntu:~/guide$ pnpm hardhat quickStart
What is the name of your key file? (key1.json / key2.json). 
If you want to generate a new key, type the name of the output file. 
(Press tab to autocomplete)
: key1.json
```

After entering the name (e.g. `key1.json`) , it will ask you whether you want to *set* (temporarily) your wallet password, which, if you choose to do so, will skip the password prompt every time you run a command.

```bash
The name of your key file is key.json, the path of your key file is keys/key1.json
Environment variable WALLET_PASSWORD has not been set
Do you want to set WALLET_PASSWORD env var to skip the password prompt? (y / n): y
Enter password for wallet: 
```

This will request your current balance for your chosen key in the selected network. After this, it will search in the `contract_addresses` directory for contracts that have already been  deployed.

```bash 
log-time :: Already deployed contracts in ./contract_addresses: c1.address, c2.address
Do you want to deploy a new instance of the contract? (y / n): n
What is the filename to load/save the deployed contract address? (e.g. file_name.address): c2.address
The name of your contract address file is c2.address, the path of your contract address file is contract_addresses/c2.address
```

It will then prompt you to provide inputs  for a homomorphic addition. 

```bash
Pick an integer in the interval (0, 127) for a: 2
Pick an integer in the interval (0, 127) for b: 54
```

It will then encrypt, add, store and decrypt the resulting ciphertext automatically. 
You may then verify the result.

### Benchmarking encryptedSum

The hardhat script `benchmarkSum` will run a benchmark for `n` number of encrypted sums with randomly-generated `a + b` values.

Run the script:
`pnpm hardhat benchmarkSum`

It prompts for the wallet key and reads `Simple.sol`'s contract address or deploys a new instance of it.

It then prompts for the number of times to run `encryptedSum`:

```
2026-01-05T21:27:48.231Z :: Loading contract address
The number of times to run encryptedSum (between 1 and 100): 3
2026-01-05T21:27:50.211Z :: You have entered 3. Generating 3 random integers each for the values of a and b...
2026-01-05T21:27:50.211Z :: Generated random a+b values:
[ [ 46, 0 ], [ 118, 114 ], [ 77, 27 ] ]
```

When the benchmark is running, SIGINT (Ctrl+C) will allow you to prematurely terminate the benchmarking on the next iteration and return the benchmark time up to the last iteration.

```
2026-01-05T21:23:54.715Z :: Running benchmark...
2026-01-05T21:23:54.715Z :: Running benchmark iteration 1:
2026-01-05T21:23:54.715Z :: Encrypting... 
Please wait for encryption... DONE!
2026-01-05T21:24:28.735Z :: Input encrypted
2026-01-05T21:24:28.737Z :: Encrypted input and ZK proof written to: encrypted_inputs.json
zkProof1: 34.022s
2026-01-05T21:24:28.738Z :: Connecting wallet
2026-01-05T21:24:28.740Z :: Connecting to contract
2026-01-05T21:24:28.744Z :: Calling storeEncryptedSimpleValue on contract
2026-01-05T21:24:28.998Z :: Transaction hash: 0x8052fc55120f748e5feeec7671914a55dcdb826e4f1c223a04c8599c12b7008b
2026-01-05T21:24:28.998Z :: Waiting for transaction to be included in block...
Please wait for transaction... DONE!
2026-01-05T21:24:37.127Z :: Transaction receipt received. Block number: 365615
2026-01-05T21:24:37.127Z :: Running benchmark iteration 2:
2026-01-05T21:24:37.127Z :: Encrypting... 
Please wait for encryption... ⠋
2026-01-05T21:24:53.854Z :: benchmarking interrupted, waiting until current iteration completes...
DONE!
2026-01-05T21:25:28.740Z :: Input encrypted
2026-01-05T21:25:28.741Z :: Encrypted input and ZK proof written to: encrypted_inputs.json
zkProof2: 51.615s
2026-01-05T21:25:28.743Z :: Connecting wallet
2026-01-05T21:25:28.745Z :: Connecting to contract
2026-01-05T21:25:28.747Z :: Calling storeEncryptedSimpleValue on contract
2026-01-05T21:25:28.995Z :: Transaction hash: 0x6c25db2a5b9ca8725fc04fc24d4e1defca02d192c200479b449aa519ed6defe7
2026-01-05T21:25:28.995Z :: Waiting for transaction to be included in block...
Please wait for transaction... DONE!
2026-01-05T21:25:37.116Z :: Transaction receipt received. Block number: 365625
2026-01-05T21:25:37.117Z :: benchmarking truncated after 2 times
2026-01-05T21:25:37.119Z :: Benchmark time for 2 iterations of encryptedSum:
benchmarkAdd: 1:42.401 (m:ss.mmm)
```


## Unit tests
To make sure the Simple contract works as expected, the unit tests can be run.

### Optalysys testnet
To test on the Optalysys testnet:

```bash
pnpm run test
> NETWORK=optalysys hardhat test

  Simple
2025-10-13T20:36:02.742Z :: Network name: optalysys
2025-10-13T20:36:02.742Z :: Loading wallet
2025-10-13T20:36:16.420Z :: Loading testnet config
2025-10-13T20:36:16.423Z :: Connecting provider
2025-10-13T20:36:16.425Z :: Connecting wallet
2025-10-13T20:36:16.428Z :: Creating fhevm instance
2025-10-13T20:36:17.609Z :: Deploying contract
2025-10-13T20:36:17.819Z :: Waiting for deployment...
2025-10-13T20:36:22.081Z :: Contract deployed at block: 6521
2025-10-13T20:36:22.082Z :: Contract address: 0x7E36e4B752c1CcE4f4ed9a88dD217D1df5Bf274f
    ✔ encrypted simple value should be uninitialized after deployment (52ms)
    ✔ store value 4 (142138ms)
    ✔ encrypted sum should be uninitialized after deployment (89ms)
    ✔ store sum (119936ms)


  4 passing (5m)
```

This will deploy the test on the testnet and run through the contract methods


### Hardhat local test
To test on Hardhat:

Open a terminal in the background to start the local network on Hardhat:

```bash
pnpm run start-localhost
> hardhat node

Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/

Accounts
========

WARNING: These accounts, and their private keys, are publicly known.
Any funds sent to them on Mainnet or any other live network WILL BE LOST.

Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Run the tests on hardhat in another terminal

```bash
pnpm run test-localhost
> hardhat test

  Simple
2025-10-13T20:43:53.853Z :: Network name: hardhat
2025-10-13T20:43:53.853Z :: Running on hardhat, using mocked config
2025-10-13T20:43:53.860Z :: Loading testnet config
2025-10-13T20:43:53.862Z :: Connecting provider
2025-10-13T20:43:53.875Z :: Using mock fhevm
2025-10-13T20:43:53.875Z :: Deploying contract
2025-10-13T20:43:53.896Z :: Waiting for deployment...
2025-10-13T20:43:53.899Z :: Contract deployed at block: 3
2025-10-13T20:43:53.900Z :: Contract address: 0x5FbDB2315678afecb367f032d93F642f64180aa3
    ✔ encrypted simple value should be uninitialized after deployment
    ✔ store value 4 (114ms)
    ✔ encrypted sum should be uninitialized after deployment
    ✔ store sum (81ms)


  4 passing (273ms)
```

This will deploy the test on the hardhat localhost and run through the contract methods


## Deploying your own contracts by using Optalysys testnet config instead of Zama's config
This assumes you have knowledge of JavaScript and smart contracts. Follow [Zama's Quick Start tutorial](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial)

The file [./tasks/contract.ts](./tasks/contract.ts) contains a deployment script. You can adapt this to deploy your own contract.

Zama has some example contracts [here](https://docs.zama.ai/protocol/examples).

This is where the instructions diverge from [Zama's instructions](https://docs.zama.ai/protocol/solidity-guides/smart-contract/configure).

Instead of inheriting from ZamaConfig, pass Optalysys's config values in the constructor.

Zama instructions:

```solidity
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyERC20 is SepoliaConfig {
  constructor() {
    // Additional initialization logic if needed
  }
}
```

Change:

```solidity
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

// REMOVE ZamaConfig
//import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// REMOVE ZamaConfig
contract MyERC20 { // is SepoliaConfig {
    constructor(
        address aclAdd,
        address fhevmExecutorAdd,
        address kmsVerifierAdd,
        address decryptionOracleAdd
    ) {
        FHE.setCoprocessor(CoprocessorConfig({
            ACLAddress: aclAdd,
            CoprocessorAddress: fhevmExecutorAdd,
            DecryptionOracleAddress: decryptionOracleAdd,
            KMSVerifierAddress: kmsVerifierAdd
        }));

    }
}
```

The Coprocessor config values will need to be set in the deploy constructor e.g.:

```javascript
await contractFactory.deploy(
  ethers.getAddress(testnetConfig.aclContractAddress),
  ethers.getAddress(testnetConfig.fhevmExecutorContractAddress),
  ethers.getAddress(testnetConfig.kmsVerifierContractAddress),
  ethers.getAddress(testnetConfig.decryptionOracleContractAddress),
);
```

Run `pnpm hardhat compile` to [generate TypeScript types](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial/write_a_simple_contract#compile-counter.sol)

### Example converting Zama's FHE Counter contract
Get the FHE Counter files from [here](https://docs.zama.ai/protocol/examples#fhecounter.sol).

The FHE Counter files have been put into the project at [contracts/FHECounter.sol](contracts/FHECounter.sol) and [test/FHECounter.test.ts](test/FHECounter.test.ts) (test only runs on hardhat localhost). Note how the constructor has been modified following the instructions in "Deploying your own contracts by using Optalysys testnet config instead of Zama's config".


Compile the contracts to create the TypeScript types:

```bash
pnpm hardhat compile
Downloading compiler 0.8.24
Generating typings for: 9 artifacts in dir: typechain-types for target: ethers-v6
Compiled 6 Solidity files successfully (evm target: cancun).

ls typechain-types/contracts/
FHECounter.ts  index.ts  Simple.sol
```

Now the TypeScript types have been generated and can be imported for hardhat tasks and tests.

Take a look at [tasks/fhecounter.ts](tasks/fhecounter.ts) which have been written for the user to interact with the smart contract by calling Hardhat tasks.

First deploy the contract

```bash
pnpm hardhat task:deployFheCounter --config-file testnet_config.json --address-file fhe_counter.address --key-file key.json 
2025-10-28T14:25:31.413Z :: Loading wallet
Set WALLET_PASSWORD env var to skip this prompt
Enter password for wallet: 
2025-10-28T14:25:32.686Z :: Loading testnet config
2025-10-28T14:25:32.687Z :: Connecting wallet
2025-10-28T14:25:32.699Z :: Deploying contract
2025-10-28T14:25:34.745Z :: Waiting for deployment...
2025-10-28T14:25:44.146Z :: Contract deployed at block: 97020
2025-10-28T14:25:44.146Z :: Contract address: 0x0Bfea07384337E0081Ee14A88b4F3CCB20FCE02D
2025-10-28T14:25:44.146Z :: Contract address written to file: fhe_counter.address
```

Encrypt the value to increment the counter by (here it's set to 4) and save it to `--input-file`

```bash
pnpm hardhat task:incrementFheCounter --input 4 --input-file inputs.json --config-file testnet_config.json --address-file fhe_counter.address --key-file key.json 
2025-10-28T14:27:44.527Z :: Loading wallet
Set WALLET_PASSWORD env var to skip this prompt
Enter password for wallet: 
2025-10-28T14:27:46.010Z :: Loading contract address
2025-10-28T14:27:46.010Z :: Loading testnet config
2025-10-28T14:27:46.011Z :: Instantiating fhevm instance
2025-10-28T14:27:46.011Z :: {
  verifyingContractAddressDecryption: '0x2a4c38464aaB36c448b373D55fEA7A9827bF6E9f',
  verifyingContractAddressInputVerification: '0x94baae27C5F3f647C31a5a7d863701C08736E797',
  inputVerifierContractAddress: '0x5D85721B3014c6ecDC8eF018d3E86Ca663639370',
  kmsContractAddress: '0x5A8ac1C8D2a8f163D875ed32bbf4FF1C530d4550',
  aclContractAddress: '0x053dC8674A6F4817d3AC01C89FbE573024f681C4',
  gatewayChainId: '678259798',
  relayerUrl: 'https://relayer.gcp-testnet-eth.dev.optalysys.com',
  network: 'https://rpc.gcp-testnet-eth.dev.optalysys.com'
}
2025-10-28T14:27:52.631Z :: Encrypting...
2025-10-28T14:29:00.535Z :: Input encrypted
2025-10-28T14:29:00.536Z :: Encrypted input and ZK proof written to: inputs.json
```

Call the contract's `increment` call with the encrypted input and ZK proof created in the previous step:

```bash
pnpm hardhat task:callIncrementFheCounter --input-file inputs.json --config-file testnet_config.json --address-file fhe_counter.address --key-file key.json 
2025-10-28T14:29:07.007Z :: Loading wallet
Set WALLET_PASSWORD env var to skip this prompt
Enter password for wallet: 
2025-10-28T14:29:07.927Z :: Loading contract address
2025-10-28T14:29:07.927Z :: Loading testnet config
2025-10-28T14:29:07.928Z :: Loading encrypted input and zkproof
2025-10-28T14:29:07.928Z :: Connecting wallet
2025-10-28T14:29:07.937Z :: Connecting to contract
2025-10-28T14:29:07.938Z :: Calling increment on contract
2025-10-28T14:29:10.313Z :: Transaction hash: 0xffaf4ad8bb1042da36ba835b2c871e5bcec7569597eaf4727a27e38ed8c0990b
2025-10-28T14:29:10.313Z :: Waiting for transaction to be included in block...
2025-10-28T14:29:19.365Z :: Transaction receipt received. Block number: 97056
```

Decrypt the counter. Note that the value of the counter has incremented by the value you have set.

```bash
pnpm hardhat task:decryptFheCounter --config-file testnet_config.json --address-file fhe_counter.address --key-file key.json 
2025-10-28T14:29:26.212Z :: Loading wallet
Set WALLET_PASSWORD env var to skip this prompt
Enter password for wallet: 
2025-10-28T14:29:27.371Z :: Loading contract address
2025-10-28T14:29:27.372Z :: Loading testnet config
2025-10-28T14:29:27.372Z :: Instantiating fhevm instance
2025-10-28T14:29:27.372Z :: {
  verifyingContractAddressDecryption: '0x2a4c38464aaB36c448b373D55fEA7A9827bF6E9f',
  verifyingContractAddressInputVerification: '0x94baae27C5F3f647C31a5a7d863701C08736E797',
  inputVerifierContractAddress: '0x5D85721B3014c6ecDC8eF018d3E86Ca663639370',
  kmsContractAddress: '0x5A8ac1C8D2a8f163D875ed32bbf4FF1C530d4550',
  aclContractAddress: '0x053dC8674A6F4817d3AC01C89FbE573024f681C4',
  gatewayChainId: '678259798',
  relayerUrl: 'https://relayer.gcp-testnet-eth.dev.optalysys.com',
  network: 'https://rpc.gcp-testnet-eth.dev.optalysys.com'
}
2025-10-28T14:29:35.748Z :: Connecting wallet
2025-10-28T14:29:35.761Z :: Connecting to contract
2025-10-28T14:29:35.763Z :: Calling getCount on contract to get ciphertext handle
2025-10-28T14:29:36.055Z :: Requesting decryption...
2025-10-28T14:29:36.055Z :: Generating keypair...
2025-10-28T14:29:36.059Z :: Creating EIP712...
2025-10-28T14:29:36.060Z :: Sign typed data...
2025-10-28T14:29:36.068Z :: User decrypt...
{
  '0x87b108a987087e1917a5163710ea79247e87cb5b83ff00000000286d6c560400': 4n
}
2025-10-28T14:30:00.035Z :: Result: 4
2025-10-28T14:30:00.035Z :: Decrypted count: 4
```

#### Your tasks

Implement hardhat tasks for **decrementing** FHE Counter by following and adapting the examples provided for incrementing.
