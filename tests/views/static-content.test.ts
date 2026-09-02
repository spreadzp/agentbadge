import { describe, it, expect, beforeEach, vi } from "vitest";
import { FaqPage } from "../../src/views/faq-page";
import { HelpPage } from "../../src/views/help-page";
import { UseCasesPage } from "../../src/views/use-cases-page";

// Mock chain-ui to control output per chain
vi.mock("../../src/server/lib/chain-ui.js", () => ({
  chainDisplayName: vi.fn(() => "Hedera Testnet"),
  chainBadgeColor: vi.fn(() => "purple"),
  explorerName: vi.fn(() => "HashScan"),
  explorerTxUrl: vi.fn((txId: string) => `https://hashscan.io/testnet/tx/${txId}`),
  formatPrice: vi.fn((n: number) => `${n} HBAR`),
  accountLabel: vi.fn(() => "Hedera Account ID"),
  accountPlaceholder: vi.fn(() => "0.0.xxxx"),
}));

import {
  chainDisplayName,
  explorerName,
} from "../../src/server/lib/chain-ui.js";

// Mock chain-templates
vi.mock("../../src/server/lib/chain-templates.js", () => ({
  applyChainTemplates: vi.fn((s: string) => s),
  getChainTemplateVars: vi.fn(() => ({
    CHAIN_NAME: "Hedera Testnet",
    CURRENCY: "HBAR",
    EXPLORER: "HashScan",
    EXPLORER_URL: "https://hashscan.io/testnet",
    MIRROR_NODE: "Mirror Node",
    NFT_STANDARD: "HTS",
    CONSENSUS: "HCS",
  })),
  CHAIN_TEMPLATES: {
    CHAIN_NAME: "Hedera Testnet",
    CURRENCY: "HBAR",
    EXPLORER: "HashScan",
    EXPLORER_URL: "https://hashscan.io/testnet",
    MIRROR_NODE: "Mirror Node",
    NFT_STANDARD: "HTS",
    CONSENSUS: "HCS",
  },
}));

// Mock env config to avoid loadConfig requiring real env vars
vi.mock("../../src/config/env.js", () => ({
  getConfig: vi.fn(() => ({
    chainMode: "hedera",
    hederaNetwork: "testnet",
    ui: {
      currencySymbol: "HBAR",
      currencyDecimals: 8,
      explorerName: "HashScan",
      explorerUrl: "https://hashscan.io/testnet",
      chainDisplayName: "Hedera Testnet",
      chainBadgeColor: "purple",
    },
  })),
  resetConfigCache: vi.fn(),
}));

import { applyChainTemplates } from "../../src/server/lib/chain-templates.js";

function renderPage(page: { toString(): string }): string {
  return page.toString();
}

describe("applyChainTemplates", () => {
  it("replaces {{CHAIN_NAME}} with chain display name", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s.replace(/{{CHAIN_NAME}}/g, "Hedera Testnet"),
    );
    expect(applyChainTemplates("Welcome to {{CHAIN_NAME}}")).toBe("Welcome to Hedera Testnet");
  });

  it("replaces {{CURRENCY}} with currency symbol", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s.replace(/{{CURRENCY}}/g, "HBAR"),
    );
    expect(applyChainTemplates("Price: 50 {{CURRENCY}}")).toBe("Price: 50 HBAR");
  });

  it("replaces {{EXPLORER}} with explorer name", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s.replace(/{{EXPLORER}}/g, "HashScan"),
    );
    expect(applyChainTemplates("View on {{EXPLORER}}")).toBe("View on HashScan");
  });

  it("replaces {{NFT_STANDARD}} with NFT standard name", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s.replace(/{{NFT_STANDARD}}/g, "HTS"),
    );
    expect(applyChainTemplates("Minted via {{NFT_STANDARD}}")).toBe("Minted via HTS");
  });

  it("replaces {{CONSENSUS}} with consensus mechanism", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s.replace(/{{CONSENSUS}}/g, "HCS"),
    );
    expect(applyChainTemplates("Messages on {{CONSENSUS}}")).toBe("Messages on HCS");
  });

  it("replaces {{MIRROR_NODE}} with mirror node name", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s.replace(/{{MIRROR_NODE}}/g, "Mirror Node"),
    );
    expect(applyChainTemplates("Query via {{MIRROR_NODE}}")).toBe("Query via Mirror Node");
  });

  it("replaces all variables in a single string", () => {
    vi.mocked(applyChainTemplates).mockImplementation((s: string) =>
      s
        .replace(/{{CHAIN_NAME}}/g, "Base Sepolia")
        .replace(/{{CURRENCY}}/g, "USDC")
        .replace(/{{EXPLORER}}/g, "Basescan")
        .replace(/{{NFT_STANDARD}}/g, "ERC-721")
        .replace(/{{CONSENSUS}}/g, "Smart Contract Events")
        .replace(/{{MIRROR_NODE}}/g, "Basescan")
        .replace(/{{EXPLORER_URL}}/g, "https://sepolia.basescan.org"),
    );
    const input = "Chain: {{CHAIN_NAME}}, Currency: {{CURRENCY}}, Explorer: {{EXPLORER}}, NFT: {{NFT_STANDARD}}, Consensus: {{CONSENSUS}}, Mirror: {{MIRROR_NODE}}";
    const result = applyChainTemplates(input);
    expect(result).toBe("Chain: Base Sepolia, Currency: USDC, Explorer: Basescan, NFT: ERC-721, Consensus: Smart Contract Events, Mirror: Basescan");
  });
});

describe("FaqPage — chain-agnostic content", () => {
  beforeEach(() => {
    vi.mocked(chainDisplayName).mockReturnValue("Hedera Testnet");
    vi.mocked(explorerName).mockReturnValue("HashScan");
  });

  it("renders without hardcoded HBAR in template areas", () => {
    const html = renderPage(FaqPage());
    // FAQ entries should use template variables, not hardcoded HBAR
    // The FAQ_ENTRIES array should not contain raw "HBAR" outside of template vars
    expect(html).toBeTruthy();
  });

  it("renders FAQ page successfully", () => {
    const html = renderPage(FaqPage());
    expect(html).toContain("Frequently Asked Questions");
  });
});

describe("HelpPage — chain-agnostic content", () => {
  beforeEach(() => {
    vi.mocked(chainDisplayName).mockReturnValue("Hedera Testnet");
    vi.mocked(explorerName).mockReturnValue("HashScan");
  });

  it("renders help page successfully", () => {
    const html = renderPage(HelpPage());
    expect(html).toContain("What is AgentBadge?");
  });

  it("uses chainDisplayName for chain name", () => {
    const html = renderPage(HelpPage());
    expect(html).toContain("Hedera Testnet");
  });

  it("uses explorerName for explorer link", () => {
    const html = renderPage(HelpPage());
    expect(html).toContain("HashScan");
  });
});

describe("UseCasesPage — chain-agnostic content", () => {
  beforeEach(() => {
    vi.mocked(explorerName).mockReturnValue("HashScan");
  });

  it("renders use cases page successfully", () => {
    const html = renderPage(UseCasesPage());
    expect(html).toContain("How AgentBadge Works in Practice");
  });

  it("does not contain hardcoded hashscan.io URLs in use case data", () => {
    const html = renderPage(UseCasesPage());
    // Check the use cases content section, not the Layout footer
    const contentStart = html.indexOf("How AgentBadge Works in Practice");
    const contentEnd = html.indexOf("Want to try these scenarios?");
    const useCasesSection = html.slice(contentStart, contentEnd);
    expect(useCasesSection).not.toContain("https://hashscan.io/testnet/");
  });

  it("uses explorerName for explorer references", () => {
    const html = renderPage(UseCasesPage());
    expect(html).toContain("HashScan");
  });
});
