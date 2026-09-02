import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskCard, TaskDetailsFragment, MarketplaceTaskBoardFragment, EscrowPanel } from "../../src/views/marketplace-fragment";
import type { MarketTask } from "../../src/server/lib/market-task";

// Mock chain-ui to control explorer URLs
vi.mock("../../src/server/lib/chain-ui.js", () => ({
  explorerTxUrl: vi.fn((txId: string) => `https://explorer.test/tx/${txId}`),
  explorerName: vi.fn(() => "TestExplorer"),
  formatPrice: vi.fn((amount: number) => `${amount} USDC`),
  accountLabel: vi.fn(() => "Wallet Address"),
  accountPlaceholder: vi.fn(() => "0x..."),
}));

import { explorerTxUrl } from "../../src/server/lib/chain-ui.js";

function makeHederaTask(overrides: Partial<MarketTask> = {}): MarketTask {
  return {
    id: "task-001",
    title: "Medical Data Analysis",
    description: "Analyze patient data for patterns",
    price: "50 HBAR",
    priceRaw: "5000000000",
    currency: "HBAR",
    capabilities: ["medical-analysis"],
    posterDid: "did:hcs:0.0.1001:1",
    posterAddress: "0.0.1001",
    txId: "0.0.1001@1700000000.000000000",
    txExplorerUrl: "https://hashscan.io/testnet/transaction/0.0.1001-1700000000-000000000",
    status: "posted",
    consensusTimestamp: "1700000000.000000000",
    createdAt: Date.now() / 1000,
    ...overrides,
  };
}

function makeBaseTask(overrides: Partial<MarketTask> = {}): MarketTask {
  return {
    id: "task-002",
    title: "AI Model Training",
    description: "Train a model on dataset X",
    price: "5 USDC",
    priceRaw: "5000000",
    currency: "USDC",
    capabilities: ["model-training"],
    posterDid: "did:eip155:84532:0xabc123...",
    posterAddress: "0xabc123def456789",
    txId: "0xdeadbeef12345678",
    txExplorerUrl: "https://sepolia.basescan.org/tx/0xdeadbeef12345678",
    status: "posted",
    consensusTimestamp: "1700000001.000000000",
    createdAt: Date.now() / 1000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TaskCard — chain-agnostic rendering", () => {
  it("renders Hedera task with price field (not priceHbar)", () => {
    const task = makeHederaTask();
    const result = TaskCard({ task }).toString();
    expect(result).toContain("50 HBAR");
    expect(result).not.toContain("priceHbar");
  });

  it("renders Base task with USDC price", () => {
    const task = makeBaseTask();
    const result = TaskCard({ task }).toString();
    expect(result).toContain("5 USDC");
    expect(result).not.toContain("HBAR");
  });

  it("uses explorerTxUrl for explorer link (chain-aware)", () => {
    const task = makeBaseTask();
    const result = TaskCard({ task }).toString();
    expect(explorerTxUrl).toHaveBeenCalledWith(task.txId);
    expect(result).toContain("https://explorer.test/tx/0xdeadbeef12345678");
  });

  it("does not contain hashscan.io for Base tasks", () => {
    const task = makeBaseTask();
    const result = TaskCard({ task }).toString();
    expect(result).not.toContain("hashscan.io");
  });

  it("does not contain hardcoded 'HBAR' text for Base tasks", () => {
    const task = makeBaseTask();
    const result = TaskCard({ task }).toString();
    expect(result).not.toMatch(/\bHBAR\b/);
  });
});

describe("TaskDetailsFragment — chain-agnostic rendering", () => {
  it("renders Base task price with USDC currency", () => {
    const task = makeBaseTask();
    const result = TaskDetailsFragment(task).toString();
    expect(result).toContain("5 USDC");
    expect(result).not.toContain("HBAR");
  });

  it("renders Hedera task price with HBAR currency", () => {
    const task = makeHederaTask();
    const result = TaskDetailsFragment(task).toString();
    expect(result).toContain("50 HBAR");
  });

  it("uses explorerTxUrl for transaction links (chain-aware)", () => {
    const task = makeBaseTask();
    const result = TaskDetailsFragment(task).toString();
    expect(explorerTxUrl).toHaveBeenCalledWith(task.txId);
    expect(result).toContain("https://explorer.test/tx/0xdeadbeef12345678");
  });

  it("does not contain 'priceHbar' anywhere", () => {
    const task = makeHederaTask();
    const result = TaskDetailsFragment(task).toString();
    expect(result).not.toContain("priceHbar");
  });
});

describe("MarketplaceTaskBoardFragment — chain-agnostic", () => {
  it("renders empty state when no tasks", () => {
    const result = MarketplaceTaskBoardFragment([]).toString();
    expect(result).toContain("No tasks available");
  });

  it("renders Base tasks without HBAR references", () => {
    const tasks = [makeBaseTask(), makeBaseTask({ id: "task-003" })];
    const result = MarketplaceTaskBoardFragment(tasks).toString();
    expect(result).toContain("5 USDC");
    expect(result).not.toContain("HBAR");
  });
});

describe("EscrowPanel — chain-agnostic", () => {
  it("renders price from MarketTask.price field", () => {
    const task = makeHederaTask({
      escrowStatus: "pending",
      scheduleId: "0.0.555",
    });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("50 HBAR");
    expect(result).not.toContain("priceHbar");
  });

  it("renders Base escrow with USDC price", () => {
    const task = makeBaseTask({
      escrowStatus: "pending",
      scheduleId: "0xescrow123",
    });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("5 USDC");
    expect(result).not.toContain("HBAR");
  });
});
