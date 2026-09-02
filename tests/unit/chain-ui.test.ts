import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  explorerTxUrl,
  explorerNftUrl,
  explorerAccountUrl,
  formatPrice,
  accountLabel,
  accountPlaceholder,
  accountPattern,
  chainDisplayName,
  explorerName,
} from "../../src/server/lib/chain-ui";

vi.mock("../../src/config/env", () => ({
  getConfig: vi.fn(),
  resetConfigCache: vi.fn(),
}));

import { getConfig } from "../../src/config/env";

type AppConfig = {
  chainMode: "hedera" | "evm" | "base";
  hederaNetwork: string;
  evm?: { explorerUrl: string };
  base?: { explorerUrl: string };
  ui: {
    chainDisplayName: string;
    currencySymbol: string;
    currencyDecimals: number;
    explorerName: string;
    accountLabel: string;
    accountPlaceholder: string;
  };
};

const hederaConfig: AppConfig = {
  chainMode: "hedera",
  hederaNetwork: "testnet",
  ui: {
    chainDisplayName: "Hedera Testnet",
    currencySymbol: "HBAR",
    currencyDecimals: 8,
    explorerName: "HashScan",
    accountLabel: "Hedera Account ID",
    accountPlaceholder: "0.0.xxxx",
  },
};

const baseConfig: AppConfig = {
  chainMode: "base",
  hederaNetwork: "testnet",
  base: { explorerUrl: "https://sepolia.basescan.org" },
  ui: {
    chainDisplayName: "Base Sepolia",
    currencySymbol: "USDC",
    currencyDecimals: 6,
    explorerName: "Basescan",
    accountLabel: "Wallet Address",
    accountPlaceholder: "0x...",
  },
};

const evmConfig: AppConfig = {
  chainMode: "evm",
  hederaNetwork: "testnet",
  evm: { explorerUrl: "https://explorer.testnet.whitechain.io" },
  ui: {
    chainDisplayName: "EVM Testnet",
    currencySymbol: "USDC",
    currencyDecimals: 6,
    explorerName: "Explorer",
    accountLabel: "Wallet Address",
    accountPlaceholder: "0x...",
  },
};

describe("chain-ui (SLICE-90-19)", () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
  });

  describe("explorerTxUrl", () => {
    it("returns hashscan.io URL for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      const url = explorerTxUrl("0.0.123@1678886400.123456789");
      expect(url).toContain("hashscan.io/testnet/transaction/");
    });

    it("returns basescan URL for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      const url = explorerTxUrl("0xabc123");
      expect(url).toBe("https://sepolia.basescan.org/tx/0xabc123");
    });

    it("returns explorer URL for EVM", () => {
      vi.mocked(getConfig).mockReturnValue(evmConfig as ReturnType<typeof getConfig>);
      const url = explorerTxUrl("0xabc123");
      expect(url).toBe("https://explorer.testnet.whitechain.io/tx/0xabc123");
    });
  });

  describe("explorerNftUrl", () => {
    it("returns hashscan token URL for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      const url = explorerNftUrl("0.0.9681741", "1");
      expect(url).toBe("https://hashscan.io/testnet/token/0.0.9681741/1");
    });

    it("returns basescan token URL for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      const url = explorerNftUrl("0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5", "1");
      expect(url).toContain("sepolia.basescan.org/token/");
      expect(url).toContain("0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5");
    });
  });

  describe("explorerAccountUrl", () => {
    it("returns hashscan account URL for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      const url = explorerAccountUrl("0.0.1234");
      expect(url).toBe("https://hashscan.io/testnet/account/0.0.1234");
    });

    it("returns basescan address URL for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      const url = explorerAccountUrl("0xabc123");
      expect(url).toBe("https://sepolia.basescan.org/address/0xabc123");
    });
  });

  describe("formatPrice", () => {
    it("formats HBAR for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      expect(formatPrice(5)).toBe("5 HBAR");
    });

    it("formats USDC for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      expect(formatPrice(5)).toBe("5 USDC");
    });

    it("formats with decimals for fractional amounts", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      expect(formatPrice(0.5)).toBe("0.5 USDC");
    });
  });

  describe("accountLabel", () => {
    it("returns 'Hedera Account ID' for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      expect(accountLabel()).toBe("Hedera Account ID");
    });

    it("returns 'Wallet Address' for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      expect(accountLabel()).toBe("Wallet Address");
    });
  });

  describe("accountPlaceholder", () => {
    it("returns '0.0.xxxx' for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      expect(accountPlaceholder()).toBe("0.0.xxxx");
    });

    it("returns '0x...' for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      expect(accountPlaceholder()).toBe("0x...");
    });
  });

  describe("accountPattern", () => {
    it("matches Hedera account format", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      const pattern = accountPattern();
      expect(pattern.test("0.0.1234")).toBe(true);
      expect(pattern.test("0xabc")).toBe(false);
    });

    it("matches EVM address format for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      const pattern = accountPattern();
      expect(pattern.test("0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5")).toBe(true);
      expect(pattern.test("0.0.1234")).toBe(false);
    });
  });

  describe("chainDisplayName", () => {
    it("returns 'Hedera Testnet' for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      expect(chainDisplayName()).toBe("Hedera Testnet");
    });

    it("returns 'Base Sepolia' for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      expect(chainDisplayName()).toBe("Base Sepolia");
    });
  });

  describe("explorerName", () => {
    it("returns 'HashScan' for Hedera", () => {
      vi.mocked(getConfig).mockReturnValue(hederaConfig as ReturnType<typeof getConfig>);
      expect(explorerName()).toBe("HashScan");
    });

    it("returns 'Basescan' for Base", () => {
      vi.mocked(getConfig).mockReturnValue(baseConfig as ReturnType<typeof getConfig>);
      expect(explorerName()).toBe("Basescan");
    });
  });
});
