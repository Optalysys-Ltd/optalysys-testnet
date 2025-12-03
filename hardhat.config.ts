import '@typechain/hardhat';
import "@nomicfoundation/hardhat-ethers";
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import { type HardhatUserConfig } from 'hardhat/config';

import "./tasks/account"
import "./tasks/contract"
import "./tasks/simple"
import "./tasks/sum"
import "./tasks/fhecounter"
import "./tasks/quickStart"

const config: HardhatUserConfig = {
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    sources: './contracts',
  },
  solidity: {
    version: '0.8.24',
    settings: {
      metadata: {
        bytecodeHash: 'none',
      },
      optimizer: {
        enabled: true,
        runs: 800,
      },
      viaIR: false,
      evmVersion: 'cancun',
    },
  },
};

export default config;
