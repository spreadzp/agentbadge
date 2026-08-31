import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassportRequestForm } from "../../src/views/passport-request-form";
import type { TierEntry } from "@agentbadge/hedera-core";

// Mock chain-ui to control output per chain
vi.mock("../../src/server/lib/chain-ui.js", () => ({
  accountLabel: vi.fn(() => "Hedera Account ID"),
  accountPlaceholder: vi.fn(() => "0.0.xxxx"),
  accountPattern: vi.fn(() => /^0\.0\.\d+$/),
  chainDisplayName: vi.fn(() => "Hedera Testnet"),
  formatPrice: vi.fn((amount: number) => `${amount} HBAR`),
}));

import {
  accountLabel,
  accountPlaceholder,
  accountPattern,
  chainDisplayName,
  formatPrice,
} from "../../src/server/lib/chain-ui.js";

const tiers: TierEntry[] = [
  { name: "bronze", price: 5, capabilities: ["task-claim"] },
  { name: "silver", price: 20, capabilities: ["task-claim", "task-create"] },
  { name: "gold", price: 50, capabilities: ["task-claim", "task-create", "escrow-manage"] },
];

function renderForm(selectedTier?: string) {
  const result = PassportRequestForm({ tiers, selectedTier });
  return typeof result === "string" ? result : String(result);
}

describe("PassportRequestForm — Hedera chain", () => {
  beforeEach(() => {
    vi.mocked(accountLabel).mockReturnValue("Hedera Account ID");
    vi.mocked(accountPlaceholder).mockReturnValue("0.0.xxxx");
    vi.mocked(accountPattern).mockReturnValue(/^0\.0\.\d+$/);
    vi.mocked(chainDisplayName).mockReturnValue("Hedera Testnet");
    vi.mocked(formatPrice).mockImplementation((n: number) => `${n} HBAR`);
  });

  it("renders account label from chain-ui", () => {
    const html = renderForm();
    expect(html).toContain("Hedera Account ID");
    expect(html).not.toContain("Wallet Address");
  });

  it("renders placeholder from chain-ui", () => {
    const html = renderForm();
    expect(html).toContain("0.0.xxxx");
  });

  it("renders pattern validation on input", () => {
    const html = renderForm();
    expect(html).toContain('pattern="');
  });

  it("renders chain display name in description", () => {
    const html = renderForm();
    expect(html).toContain("Hedera Testnet");
    expect(html).not.toContain("mint an on-chain passport NFT on Hedera");
  });

  it("uses formatPrice for tier price", () => {
    const html = renderForm("bronze");
    expect(html).toContain("5 HBAR");
  });

  it("does not contain hardcoded 'on Hedera' text", () => {
    const html = renderForm();
    expect(html).not.toMatch(/on Hedera/i);
  });
});

describe("PassportRequestForm — Base chain", () => {
  beforeEach(() => {
    vi.mocked(accountLabel).mockReturnValue("Wallet Address");
    vi.mocked(accountPlaceholder).mockReturnValue("0x...");
    vi.mocked(accountPattern).mockReturnValue(/^0x[a-fA-F0-9]{40}$/);
    vi.mocked(chainDisplayName).mockReturnValue("Base Sepolia");
    vi.mocked(formatPrice).mockImplementation((n: number) => `${n} USDC`);
  });

  it("renders wallet address label", () => {
    const html = renderForm();
    expect(html).toContain("Wallet Address");
    expect(html).not.toContain("Hedera Account ID");
  });

  it("renders 0x placeholder", () => {
    const html = renderForm();
    expect(html).toContain("0x...");
  });

  it("renders Base Sepolia in description", () => {
    const html = renderForm();
    expect(html).toContain("Base Sepolia");
  });

  it("uses formatPrice with USDC", () => {
    const html = renderForm("silver");
    expect(html).toContain("20 USDC");
  });

  it("does not contain hardcoded HBAR text", () => {
    const html = renderForm();
    expect(html).not.toMatch(/\bHBAR\b/);
  });
});
