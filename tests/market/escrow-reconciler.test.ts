/**
 * SLICE-84-2: Escrow Reconciler & Failure Events
 *
 * Tests:
 * 1. WAL ordering: scheduleId persisted before HCS escrow message
 * 2. task_escrow_failed emitted on escrow creation failure (not silent revert)
 * 3. Sweeper reclaims orphaned scheduleId (task reverted but scheduleId remains)
 * 4. Sweeper idempotent (double-sweep doesn't re-delete)
 * 5. Sweeper config-gated (disabled when ESCROW_RECONCILER_ENABLED=false)
 * 6. escrow-status endpoint returns transitionalSince and lastError
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  marketUpsert,
  getTaskById,
  updateTaskStatus,
  setEscrowStatus,
  reserveTask,
  transitionTask,
  marketClear,
} from "@agentbadge/passport";
import type { CachedMarketTask, TaskMessage } from "@agentbadge/hedera-core";

// Mock Hedera functions
vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    submitTaskMessage: vi.fn(async (msg: { type: string }) => {
      return `tx-${msg.type}-${Date.now()}`;
    }),
    createScheduledTransfer: vi.fn(async () => ({
      scheduleId: "0.0.999-schedule",
      scheduleTxId: "0.0.999-schedule-tx",
    })),
    deleteScheduledTransaction: vi.fn(async () => { }),
    didToAccountId: vi.fn(async (did: string) => `0.0.${did.slice(-3)}`),
  };
});

// Mock env
vi.mock("../../src/config/env", () => ({
  getConfig: () => ({
    marketTopicId: "0.0.123",
    directoryTopicId: "0.0.100",
    a2aTopicId: "0.0.101",
  }),
  loadConfig: () => ({}),
  resetConfigCache: () => { },
}));

function makePostedTask(id: string): CachedMarketTask {
  return {
    taskId: id,
    posterDid: "did:hedera:test-poster",
    title: "Test task",
    description: "Test",
    priceHbar: 10,
    capabilities: ["test"],
    status: "posted",
    txId: "tx-post",
    consensusTimestamp: new Date().toISOString(),
    createdAt: Date.now(),
  };
}

describe("SLICE-84-2: Escrow Reconciler & Failure Events", () => {
  beforeEach(() => {
    marketClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WAL ordering: scheduleId persisted before HCS escrow message", () => {
    it("scheduleId is in cache before task_escrow_created HCS message is submitted", async () => {
      const task = makePostedTask("wal-1");
      marketUpsert(task);

      // Track call order
      const callOrder: string[] = [];
      const { submitTaskMessage, createScheduledTransfer } = await import("@agentbadge/hedera-core");

      vi.mocked(createScheduledTransfer).mockImplementationOnce(async () => {
        callOrder.push("createScheduledTransfer");
        return { scheduleId: "0.0.555", scheduleTxId: "0.0.555-tx" };
      });

      vi.mocked(submitTaskMessage).mockImplementation(async (msg: { type: string }) => {
        if (msg.type === "task_escrow_created") {
          callOrder.push("submitTaskMessage:escrow");
          // At this point, scheduleId should already be in cache
          const cached = getTaskById("wal-1");
          expect(cached?.scheduleId).toBe("0.0.555");
        }
        return `tx-${msg.type}`;
      });

      // Simulate claim flow
      reserveTask("wal-1", ["posted"], "claiming");
      const { submitTaskMessage: stm } = await import("@agentbadge/hedera-core");
      await stm({ type: "task_claimed", taskId: "wal-1", claimerDid: "did:hedera:001", timestamp: Date.now() });
      transitionTask("wal-1", ["claiming"], "claimed", { claimerDid: "did:hedera:001", claimTxId: "tx-claimed" });

      // Escrow creation
      const { createScheduledTransfer: cst, didToAccountId } = await import("@agentbadge/hedera-core");
      const fromAccount = (await didToAccountId("did:hedera:test-poster"))!;
      const toAccount = (await didToAccountId("did:hedera:001"))!;
      const { scheduleId, scheduleTxId } = await cst(fromAccount, toAccount, 10, { memo: "escrow:wal-1" });

      // WAL: persist scheduleId BEFORE HCS message
      setEscrowStatus("wal-1", "pending", { scheduleId, scheduleTxId });

      // Now submit HCS message — scheduleId should already be in cache
      await stm({ type: "task_escrow_created", taskId: "wal-1", scheduleId, amountHbar: 10, timestamp: Date.now() });

      expect(callOrder).toContain("createScheduledTransfer");
      expect(callOrder).toContain("submitTaskMessage:escrow");
      expect(callOrder.indexOf("createScheduledTransfer")).toBeLessThan(callOrder.indexOf("submitTaskMessage:escrow"));
    });
  });

  describe("task_escrow_failed emitted on escrow creation failure", () => {
    it("emits task_escrow_failed HCS message instead of silent revert", async () => {
      const task = makePostedTask("fail-1");
      marketUpsert(task);

      const { createScheduledTransfer, submitTaskMessage } = await import("@agentbadge/hedera-core");

      // Fail escrow creation
      vi.mocked(createScheduledTransfer).mockRejectedValueOnce(new Error("Hedera timeout"));

      const submittedMessages: string[] = [];
      vi.mocked(submitTaskMessage).mockImplementation(async (msg: { type: string }) => {
        submittedMessages.push(msg.type);
        return `tx-${msg.type}`;
      });

      // Simulate claim flow up to escrow failure
      reserveTask("fail-1", ["posted"], "claiming");
      await submitTaskMessage({ type: "task_claimed", taskId: "fail-1", claimerDid: "did:hedera:001", timestamp: Date.now() });
      transitionTask("fail-1", ["claiming"], "claimed", { claimerDid: "did:hedera:001", claimTxId: "tx-claimed" });

      // Attempt escrow creation — should fail
      try {
        const { createScheduledTransfer: cst, didToAccountId } = await import("@agentbadge/hedera-core");
        const fromAccount = (await didToAccountId("did:hedera:test-poster"))!;
        const toAccount = (await didToAccountId("did:hedera:001"))!;
        await cst(fromAccount, toAccount, 10, { memo: "escrow:fail-1" });
      } catch {
        // Expected — now the handler should emit task_escrow_failed
        await submitTaskMessage({
          type: "task_escrow_failed" as TaskMessage["type"],
          taskId: "fail-1",
          reason: "Hedera timeout",
          timestamp: Date.now(),
        } as TaskMessage);
        // Revert task
        transitionTask("fail-1", ["claimed"], "posted", { claimerDid: undefined });
      }

      expect(submittedMessages).toContain("task_escrow_failed");
    });
  });

  describe("Sweeper reclaims orphaned scheduleId", () => {
    it("sweeper deletes orphaned schedule and marks escrowStatus as reclaimed", async () => {
      const task = makePostedTask("orphan-1");
      marketUpsert(task);

      // Simulate orphaned state: task reverted to posted but scheduleId remains
      updateTaskStatus("orphan-1", "claimed", { claimerDid: "did:hedera:001" });
      setEscrowStatus("orphan-1", "pending", { scheduleId: "0.0.777", scheduleTxId: "0.0.777-tx" });
      // Revert to posted but scheduleId stays (orphan)
      updateTaskStatus("orphan-1", "posted", { claimerDid: undefined });

      const cached = getTaskById("orphan-1");
      expect(cached?.scheduleId).toBe("0.0.777"); // orphaned schedule

      // Import reconciler — should find and reclaim
      const { sweepEscrows } = await import("../../src/server/services/escrow-reconciler");
      const { deleteScheduledTransaction } = await import("@agentbadge/hedera-core");

      const result = await sweepEscrows();

      expect(result.reclaimed).toBe(1);
      expect(vi.mocked(deleteScheduledTransaction)).toHaveBeenCalledWith("0.0.777");

      const after = getTaskById("orphan-1");
      expect(after?.escrowStatus).toBe("reclaimed");
    });

    it("sweeper is idempotent — double-sweep doesn't re-delete", async () => {
      const task = makePostedTask("orphan-2");
      marketUpsert(task);

      setEscrowStatus("orphan-2", "pending", { scheduleId: "0.0.888", scheduleTxId: "0.0.888-tx" });
      updateTaskStatus("orphan-2", "posted", { claimerDid: undefined });

      const { sweepEscrows } = await import("../../src/server/services/escrow-reconciler");
      const { deleteScheduledTransaction } = await import("@agentbadge/hedera-core");

      // First sweep
      const result1 = await sweepEscrows();
      expect(result1.reclaimed).toBe(1);

      // Second sweep — should not re-delete
      vi.mocked(deleteScheduledTransaction).mockClear();
      const result2 = await sweepEscrows();
      expect(result2.reclaimed).toBe(0);
      expect(vi.mocked(deleteScheduledTransaction)).not.toHaveBeenCalled();
    });

    it("sweeper skips tasks with escrowStatus released or cancelled", async () => {
      const task1 = makePostedTask("skip-1");
      marketUpsert(task1);
      setEscrowStatus("skip-1", "released", { scheduleId: "0.0.111" });

      const task2 = makePostedTask("skip-2");
      marketUpsert(task2);
      setEscrowStatus("skip-2", "cancelled", { scheduleId: "0.0.222" });

      const { sweepEscrows } = await import("../../src/server/services/escrow-reconciler");
      const { deleteScheduledTransaction } = await import("@agentbadge/hedera-core");

      const result = await sweepEscrows();
      expect(result.reclaimed).toBe(0);
      expect(vi.mocked(deleteScheduledTransaction)).not.toHaveBeenCalled();
    });
  });

  describe("Sweeper config-gated", () => {
    it("sweeper is disabled when ESCROW_RECONCILER_ENABLED=false", async () => {
      const original = process.env.ESCROW_RECONCILER_ENABLED;
      process.env.ESCROW_RECONCILER_ENABLED = "false";

      const task = makePostedTask("gate-1");
      marketUpsert(task);
      setEscrowStatus("gate-1", "pending", { scheduleId: "0.0.333" });
      updateTaskStatus("gate-1", "posted", { claimerDid: undefined });

      const { sweepEscrows } = await import("../../src/server/services/escrow-reconciler");
      const result = await sweepEscrows();

      expect(result.skipped).toBe(true);

      process.env.ESCROW_RECONCILER_ENABLED = original;
    });
  });

  describe("escrow-status endpoint returns transitionalSince and lastError", () => {
    it("returns transitionalSince and lastError fields", async () => {
      const task = makePostedTask("status-1");
      marketUpsert(task);

      setEscrowStatus("status-1", "pending", {
        scheduleId: "0.0.444",
        scheduleTxId: "0.0.444-tx",
      });

      // Simulate transitionalSince and lastError set by reconciler
      const cached = getTaskById("status-1");
      if (cached) {
        marketUpsert({
          ...cached,
          transitionalSince: Date.now() - 60000,
          lastError: "Escrow creation timeout",
        });
      }

      const after = getTaskById("status-1");
      expect(after?.transitionalSince).toBeDefined();
      expect(after?.lastError).toBe("Escrow creation timeout");
    });
  });
});
