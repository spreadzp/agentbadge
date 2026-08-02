import { describe, it, expect, beforeEach } from "vitest";
import {
  marketUpsert as upsert,
  marketGet as getTask,
  updateTaskStatus,
  returnTaskToMarket,
  setEscrowStatus,
  marketClear as clear,
} from "@agentgate-hedera/passport";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

function makeTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-cache-test",
    posterDid: "did:hcs:0.0.1:1",
    title: "Test",
    description: "Test desc",
    priceHbar: 5,
    capabilities: ["api_call"],
    status: "posted",
    txId: "0.0.2@1.1",
    consensusTimestamp: "1.1",
    createdAt: Date.now(),
    ...overrides,
  } as CachedMarketTask;
}

describe("SLICE-24-7: VALID_TRANSITIONS — new escrow transitions", () => {
  beforeEach(() => clear());

  it("posted → cancelled (poster cancels before claim)", () => {
    const task = makeTask({ status: "posted" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "cancelled")).toBe(true);
    expect(getTask("task-cache-test")?.status).toBe("cancelled");
  });

  it("claimed → posted (return to market after verification fail)", () => {
    const task = makeTask({ status: "claimed", claimerDid: "did:hcs:0.0.1:2" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "posted")).toBe(true);
    expect(getTask("task-cache-test")?.status).toBe("posted");
  });

  it("claimed → cancelled (poster cancels after claim)", () => {
    const task = makeTask({ status: "claimed", claimerDid: "did:hcs:0.0.1:2" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "cancelled")).toBe(true);
    expect(getTask("task-cache-test")?.status).toBe("cancelled");
  });

  it("delivered → posted (verification fail 3x, return to market)", () => {
    const task = makeTask({ status: "delivered", claimerDid: "did:hcs:0.0.1:2" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "posted")).toBe(true);
    expect(getTask("task-cache-test")?.status).toBe("posted");
  });

  it("delivered → cancelled (poster cancels after delivery)", () => {
    const task = makeTask({ status: "delivered", claimerDid: "did:hcs:0.0.1:2" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "cancelled")).toBe(true);
    expect(getTask("task-cache-test")?.status).toBe("cancelled");
  });

  it("completed → posted still rejected", () => {
    const task = makeTask({ status: "completed" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "posted")).toBe(false);
    expect(getTask("task-cache-test")?.status).toBe("completed");
  });

  it("cancelled → posted still rejected (terminal state)", () => {
    const task = makeTask({ status: "cancelled" });
    upsert(task);
    expect(updateTaskStatus("task-cache-test", "posted")).toBe(false);
    expect(getTask("task-cache-test")?.status).toBe("cancelled");
  });
});

describe("SLICE-24-7: returnTaskToMarket", () => {
  beforeEach(() => clear());

  it("sets status to posted, clears claimerDid, resets verificationAttempts", () => {
    const task = makeTask({
      status: "claimed",
      claimerDid: "did:hcs:0.0.1:5",
      claimTxId: "0.0.3@2.2",
      scheduleId: "0.0.555",
      verificationAttempts: 2,
      escrowStatus: "pending",
    });
    upsert(task);

    expect(returnTaskToMarket("task-cache-test")).toBe(true);

    const updated = getTask("task-cache-test");
    expect(updated?.status).toBe("posted");
    expect(updated?.claimerDid).toBeUndefined();
    expect(updated?.claimTxId).toBeUndefined();
    expect(updated?.scheduleId).toBeUndefined();
    expect(updated?.verificationAttempts).toBe(0);
    expect(updated?.escrowStatus).toBe("cancelled");
  });

  it("returns false for non-existent task", () => {
    expect(returnTaskToMarket("nonexistent")).toBe(false);
  });
});

describe("SLICE-24-7: setEscrowStatus", () => {
  beforeEach(() => clear());

  it("updates escrowStatus without changing task status", () => {
    const task = makeTask({ status: "claimed", escrowStatus: "pending" });
    upsert(task);

    expect(setEscrowStatus("task-cache-test", "released")).toBe(true);

    const updated = getTask("task-cache-test");
    expect(updated?.status).toBe("claimed");
    expect(updated?.escrowStatus).toBe("released");
  });

  it("updates escrowStatus with extra fields", () => {
    const task = makeTask({ status: "claimed", escrowStatus: "pending" });
    upsert(task);

    expect(setEscrowStatus("task-cache-test", "expired", { scheduleId: "0.0.999" })).toBe(true);

    const updated = getTask("task-cache-test");
    expect(updated?.escrowStatus).toBe("expired");
    expect(updated?.scheduleId).toBe("0.0.999");
  });

  it("returns false for non-existent task", () => {
    expect(setEscrowStatus("nonexistent", "released")).toBe(false);
  });
});
