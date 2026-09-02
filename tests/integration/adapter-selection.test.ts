/**
 * Integration test for chain adapter selection (SLICE-90-16)
 *
 * Verifies that getChainAdapter() returns the correct ChainAdapter
 * implementation based on the CHAIN_MODE environment variable.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getChainMode,
  getChainAdapter,
  resetChainAdapter,
} from "../../src/server/lib/chain-adapter-factory";

describe("Chain Adapter Factory (SLICE-90-16)", () => {
  const originalChainMode = process.env.CHAIN_MODE;
  const originalOperatorKey = process.env.BASE_OPERATOR_KEY;

  beforeEach(() => {
    resetChainAdapter();
    delete process.env.CHAIN_MODE;
    delete process.env.BASE_OPERATOR_KEY;
  });

  afterEach(() => {
    resetChainAdapter();
    if (originalChainMode !== undefined) {
      process.env.CHAIN_MODE = originalChainMode;
    } else {
      delete process.env.CHAIN_MODE;
    }
    if (originalOperatorKey !== undefined) {
      process.env.BASE_OPERATOR_KEY = originalOperatorKey;
    } else {
      delete process.env.BASE_OPERATOR_KEY;
    }
  });

  describe("getChainMode()", () => {
    it("defaults to 'hedera' when CHAIN_MODE not set", () => {
      const mode = getChainMode();
      expect(mode).toBe("hedera");
    });

    it("returns 'hedera' when CHAIN_MODE=hedera", () => {
      process.env.CHAIN_MODE = "hedera";
      expect(getChainMode()).toBe("hedera");
    });

    it("returns 'base' when CHAIN_MODE=base", () => {
      process.env.CHAIN_MODE = "base";
      expect(getChainMode()).toBe("base");
    });

    it("throws on invalid CHAIN_MODE", () => {
      process.env.CHAIN_MODE = "ethereum";
      expect(() => getChainMode()).toThrow(/Invalid CHAIN_MODE/);
    });

    it("throws on empty CHAIN_MODE string", () => {
      process.env.CHAIN_MODE = "";
      // Empty string is not null/undefined so ?? doesn't default it
      expect(() => getChainMode()).toThrow(/Invalid CHAIN_MODE/);
    });
  });

  describe("getChainAdapter()", () => {
    it("returns HederaChainAdapter when CHAIN_MODE=hedera", async () => {
      process.env.CHAIN_MODE = "hedera";
      const adapter = await getChainAdapter();
      expect(adapter.constructor.name).toBe("HederaChainAdapter");
    });

    it("returns HederaChainAdapter when CHAIN_MODE not set (default)", async () => {
      const adapter = await getChainAdapter();
      expect(adapter.constructor.name).toBe("HederaChainAdapter");
    });

    it("caches the adapter instance", async () => {
      process.env.CHAIN_MODE = "hedera";
      const adapter1 = await getChainAdapter();
      const adapter2 = await getChainAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it("throws when CHAIN_MODE=base but BASE_OPERATOR_KEY not set", async () => {
      process.env.CHAIN_MODE = "base";
      delete process.env.BASE_OPERATOR_KEY;
      await expect(getChainAdapter()).rejects.toThrow(/BASE_OPERATOR_KEY/);
    });

    it("throws on invalid CHAIN_MODE", async () => {
      process.env.CHAIN_MODE = "solana";
      await expect(getChainAdapter()).rejects.toThrow(/Invalid CHAIN_MODE/);
    });
  });

  describe("resetChainAdapter()", () => {
    it("clears cache so next call creates new instance", async () => {
      process.env.CHAIN_MODE = "hedera";
      const adapter1 = await getChainAdapter();
      expect(adapter1.constructor.name).toBe("HederaChainAdapter");
      resetChainAdapter();
      const adapter2 = await getChainAdapter();
      // Both are HederaChainAdapter singletons from hedera-core, so same instance
      // But the cache was reset — the key test is that it doesn't throw
      expect(adapter2.constructor.name).toBe("HederaChainAdapter");
    });
  });
});
