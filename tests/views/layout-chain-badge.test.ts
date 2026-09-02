import { describe, it, expect, beforeEach, vi } from "vitest";
import { Layout } from "../../src/views/layout";

// Mock chain-ui to control chainDisplayName and chainBadgeColor
vi.mock("../../src/server/lib/chain-ui.js", () => ({
  chainDisplayName: vi.fn(() => "Hedera Testnet"),
  chainBadgeColor: vi.fn(() => "purple"),
  explorerName: vi.fn(() => "HashScan"),
  explorerTxUrl: vi.fn((txId: string) => `https://hashscan.io/testnet/tx/${txId}`),
  explorerNftUrl: vi.fn(() => ""),
  explorerAccountUrl: vi.fn(() => ""),
  formatPrice: vi.fn((n: number) => `${n} HBAR`),
  accountLabel: vi.fn(() => "Hedera Account ID"),
  accountPlaceholder: vi.fn(() => "0.0.xxxx"),
  accountPattern: vi.fn(() => /^0\.0\.\d+$/),
}));

// Mock chain-templates so json-ld.ts getChainTemplateVars works
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
}));

// Mock env config so json-ld.ts chainCurrency works
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

import { chainDisplayName, chainBadgeColor } from "../../src/server/lib/chain-ui.js";

function renderLayout(): string {
  return Layout("<p>test content</p>", "Test Page").toString();
}

describe("SLICE-90-23: Chain badge in header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chainDisplayName).mockReturnValue("Hedera Testnet");
    vi.mocked(chainBadgeColor).mockReturnValue("purple");
  });

  it("renders chain badge with display name", () => {
    vi.mocked(chainDisplayName).mockReturnValue("Hedera Testnet");
    const html = renderLayout();
    expect(html).toContain("Hedera Testnet");
    expect(html).toContain("chain-badge");
  });

  it("renders chain badge with purple color for Hedera", () => {
    vi.mocked(chainBadgeColor).mockReturnValue("purple");
    const html = renderLayout();
    expect(html).toContain("purple");
  });

  it("renders chain badge with blue color for Base", () => {
    vi.mocked(chainDisplayName).mockReturnValue("Base Sepolia");
    vi.mocked(chainBadgeColor).mockReturnValue("blue");
    const html = renderLayout();
    expect(html).toContain("Base Sepolia");
    expect(html).toContain("blue");
  });

  it("does not render badge when chainDisplayName is empty", () => {
    vi.mocked(chainDisplayName).mockReturnValue("");
    const html = renderLayout();
    expect(html).not.toContain("chain-badge");
  });

  it("badge is a non-interactive element (no dropdown, no select)", () => {
    vi.mocked(chainDisplayName).mockReturnValue("Hedera Testnet");
    const html = renderLayout();
    // Badge should be a span with chain-badge class
    expect(html).toContain("chain-badge");
    expect(html).toMatch(/<span[^>]*chain-badge/);
    // Badge should not be a button, select, or anchor
    const badgeStart = html.indexOf('class="chain-badge');
    const badgeEnd = html.indexOf("</span>", badgeStart);
    const badgeHtml = html.slice(badgeStart - 6, badgeEnd + 7);
    expect(badgeHtml).not.toContain("<select");
    expect(badgeHtml).not.toContain("<button");
    expect(badgeHtml).not.toContain("<a ");
  });
});
