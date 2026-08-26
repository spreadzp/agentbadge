import { describe, it, expect } from "vitest";
import { EscrowPanel } from "../../src/views/marketplace-fragment";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

function makeTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-123",
    title: "Test Task",
    description: "Test description",
    status: "claimed",
    priceHbar: 50,
    capabilities: ["medical-analysis"],
    posterDid: "did:hcs:0.0.1001:1",
    claimerDid: "did:hcs:0.0.1002:2",
    createdAt: Date.now() / 1000,
    txId: "0.0.1001@1700000000.000000000",
    ...overrides,
  } as CachedMarketTask;
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

  it("includes HashScan link when scheduleId present", () => {
    const task = makeTask({ escrowStatus: "pending", scheduleId: "0.0.555" });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("hashscan.io");
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
    const task = makeTask({ escrowStatus: "pending", scheduleId: "0.0.555", priceHbar: 75 });
    const result = EscrowPanel(task).toString();
    expect(result).toContain("75 HBAR");
  });
});
