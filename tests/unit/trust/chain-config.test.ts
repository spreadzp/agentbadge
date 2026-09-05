import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getChainConfig, WHITECHAIN_SEPOLIA, BASE_SEPOLIA } from "../../../src/agent-readiness/trust/chain-config";

describe("SLICE-102-5: chain-config", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CHAIN_MODE;
    delete process.env.AGENT_PASSPORT_NFT_ADDRESS;
    delete process.env.WHITECHAIN_RPC_URL;
    delete process.env.BASE_RPC_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("getChainConfig()", () => {
    it("returns local fallback when CHAIN_MODE not set", () => {
      const config = getChainConfig();
      expect(config.chainId).toBe(31337);
      expect(config.name).toBe("hardhat-local");
    });

    it("returns whitechain config for CHAIN_MODE=evm", () => {
      process.env.CHAIN_MODE = "evm";
      process.env.AGENT_PASSPORT_NFT_ADDRESS = "0x1234567890123456789012345678901234567890";
      process.env.WHITECHAIN_RPC_URL = "https://rpc.testnet.whitechain.io";

      const config = getChainConfig();
      expect(config.chainId).toBe(1874);
      expect(config.name).toBe("whitechain-sepolia");
      expect(config.contractAddress).toBe("0x1234567890123456789012345678901234567890");
    });

    it("returns base config for CHAIN_MODE=base", () => {
      process.env.CHAIN_MODE = "base";
      process.env.AGENT_PASSPORT_NFT_ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      process.env.BASE_RPC_URL = "https://sepolia.base.org";

      const config = getChainConfig();
      expect(config.chainId).toBe(84532);
      expect(config.name).toBe("base-sepolia");
      expect(config.contractAddress).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    });

    it("throws if AGENT_PASSPORT_NFT_ADDRESS missing for evm mode", () => {
      process.env.CHAIN_MODE = "evm";
      process.env.WHITECHAIN_RPC_URL = "https://rpc.testnet.whitechain.io";

      expect(() => getChainConfig()).toThrow("AGENT_PASSPORT_NFT_ADDRESS");
    });

    it("throws if AGENT_PASSPORT_NFT_ADDRESS is zero address for evm mode", () => {
      process.env.CHAIN_MODE = "evm";
      process.env.AGENT_PASSPORT_NFT_ADDRESS = "0x0000000000000000000000000000000000000000";
      process.env.WHITECHAIN_RPC_URL = "https://rpc.testnet.whitechain.io";

      expect(() => getChainConfig()).toThrow("AGENT_PASSPORT_NFT_ADDRESS");
    });
  });

  describe("WHITECHAIN_SEPOLIA constant", () => {
    it("has correct chainId", () => {
      expect(WHITECHAIN_SEPOLIA.chainId).toBe(1874);
    });

    it("has correct name", () => {
      expect(WHITECHAIN_SEPOLIA.name).toBe("whitechain-sepolia");
    });
  });

  describe("BASE_SEPOLIA constant", () => {
    it("has correct chainId", () => {
      expect(BASE_SEPOLIA.chainId).toBe(84532);
    });
  });
});
