/**
 * SLICE-102-5: Chain configuration for on-chain attestation services.
 *
 * Reads EVM chain config from env vars, validates required fields,
 * provides fallback for local/testing.
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  contractAddress: string;
}

export function getWhitechainSepolia(): ChainConfig {
  return {
    chainId: 1874,
    name: "whitechain-sepolia",
    rpcUrl: process.env.WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io",
    contractAddress: process.env.AGENT_PASSPORT_NFT_ADDRESS ?? "",
  };
}

export function getBaseSepolia(): ChainConfig {
  return {
    chainId: 84532,
    name: "base-sepolia",
    rpcUrl: process.env.BASE_RPC_URL ?? "https://sepolia.base.org",
    contractAddress: process.env.AGENT_PASSPORT_NFT_ADDRESS ?? "",
  };
}

// Backward-compatible constants (evaluated at import time)
export const WHITECHAIN_SEPOLIA = getWhitechainSepolia();
export const BASE_SEPOLIA = getBaseSepolia();

const LOCAL_FALLBACK: ChainConfig = {
  chainId: 31337,
  name: "hardhat-local",
  rpcUrl: "http://127.0.0.1:8545",
  contractAddress: "0x0000000000000000000000000000000000000001",
};

/**
 * Get chain config from env vars.
 * Validates that rpcUrl and contractAddress are present.
 * Falls back to LOCAL_FALLBACK when CHAIN_MODE is not set (testing).
 */
export function getChainConfig(): ChainConfig {
  const chainMode = process.env.CHAIN_MODE ?? "local";

  let config: ChainConfig;

  if (chainMode === "base") {
    config = getBaseSepolia();
  } else if (chainMode === "evm") {
    config = getWhitechainSepolia();
  } else {
    config = LOCAL_FALLBACK;
  }

  if (!config.rpcUrl) {
    throw new Error(`Chain config error: rpcUrl is required (CHAIN_MODE=${chainMode})`);
  }

  if (!config.contractAddress || config.contractAddress === "0x0000000000000000000000000000000000000000") {
    if (chainMode !== "local") {
      throw new Error(
        `Chain config error: AGENT_PASSPORT_NFT_ADDRESS is required for CHAIN_MODE=${chainMode}`,
      );
    }
  }

  return config;
}
