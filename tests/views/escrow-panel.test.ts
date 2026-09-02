import { describe, it, expect, vi } from "vitest";
import { EscrowPanel } from "../../src/views/marketplace-fragment";
import type { MarketTask } from "../../src/server/lib/market-task.js";

vi.mock("../../src/server/lib/chain-ui.js", () => ({
  explorerTxUrl: (txId: string) => `https://explorer.test/tx/${txId}`,
  explorerName: () => "Explorer",
  accountPlaceholder: () => "0.0.xxxx",
  formatPrice: (raw: string | number) => `${raw} HBAR`,
}));

function makeTask(overrides: Partial<MarketTask> = {}): MarketTask {
  return {
    id: "task-123",
    title: "Test Task",
    description: "Test description",
    status: "claimed",
    price: "50 HBAR",
    priceRaw: "5000000000",
    currency: "HBAR",
    capabilities: ["medical-analysis"],
    posterDid: "did:hcs:0.0.1001:1",
    posterAddress: "0.0.1001",
    txId: "0.0.1001@1700000000.000000000",
    txExplorerUrl: "https://explorer.test/tx/0.0.1001@1700000000.000000000",
    consensusTimestamp: "1700000000.000000000",
    createdAt: Date.now() / 1000,
    ...overrides,
  };
}

describe("EscrowPanel", () => {
  it("returns empty string when no escrow and no scheduleId", () => {
    const task = makeTask();
    const result = EscrowPanel(task).toString();
    expect(result).toBe("");
  });

  it("renders with pending status", () => {
    const task = makeTask({ escrowStatus: "pending", scheduleId: "0.0.555" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("Escrow Status");
    expect(result).toContain("pending");
  });

  it("renders with released status", () => {
    const task = makeTask({ escrowStatus: "released", scheduleId: "0.0.555" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("released");
  });

  it("renders with cancelled status", () => {
    const task = makeTask({ escrowStatus: "cancelled", scheduleId: "0.0.555" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("cancelled");
  });

  it("includes explorer link when scheduleId present", () => {
    const task = makeTask({ escrowStatus: "pending", scheduleId: "0.0.555" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("explorer.test");
    expect(result).toContain("0.0.555");
  });

  it("includes HTMX auto-refresh attribute", () => {
    const task = makeTask({ escrowStatus: "pending", scheduleId: "0.0.555" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("hx-trigger=\"every 5s\"");
  });

  it("shows Sign & Release button for poster when delivered and pending", () => {
    const task = makeTask({
      status: "delivered",
      escrowStatus: "pending",
      scheduleId: "0.0.555",
    });
    const result = EscrowPanel(task, "did:hcs:0.0.1001:1").toString();
    expect(result).toContain("Sign & Release");
  });

  it("hides Sign & Release button for non-poster", () => {
    const task = makeTask({
      status: "delivered",
      escrowStatus: "pending",
      scheduleId: "0.0.555",
    });
    const result = EscrowPanel(task, "did:hcs:0.0.9999:9").toString();
    expect(result).not.toContain("Sign & Release");
  });

  it("shows Cancel & Refund button for poster when posted and pending", () => {
    const task = makeTask({
      status: "posted",
      escrowStatus: "pending",
      scheduleId: "0.0.555",
    });
    const result = EscrowPanel(task, "did:hcs:0.0.1001:1").toString();
    expect(result).toContain("Cancel & Refund");
  });

  it("hides action buttons when escrow is released", () => {
    const task = makeTask({
      status: "completed",
      escrowStatus: "released",
      scheduleId: "0.0.555",
    });
    const result = EscrowPanel(task, "did:hcs:0.0.1001:1").toString();
    expect(result).not.toContain("Sign & Release");
    expect(result).not.toContain("Cancel & Refund");
  });

  it("includes price in escrow panel", () => {
    const task = makeTask({ escrowStatus: "pending", scheduleId: "0.0.555", price: "75 HBAR" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("75 HBAR");
  });
});
