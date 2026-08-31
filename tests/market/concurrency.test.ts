/**
 * SLICE-84-1: CAS transition concurrency tests.
 *
 * Verifies that reserve→act→commit pattern prevents duplicate transitions
 * under parallelism. Mocks HCS latency with setTimeout to simulate real I/O.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  marketUpsert,
  getTaskById,
  reserveTask,
  transitionTask,
  listTasks,
  marketClear,
} from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

// Helper: create a task in "posted" state
function makePostedTask(id: string): CachedMarketTask {
  return {
    taskId: id,
    posterDid: "did:hedera:test",
    title: "Test task",
    description: "Test",
    priceHbar: 10,
    capabilities: ["test"],
    status: "posted",
    txId: "0.0.1234",
    consensusTimestamp: new Date().toISOString(),
    createdAt: Date.now(),
  };
}

// Simulate async HCS latency
function hcsDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50));
}

describe("SLICE-84-1: CAS transitions — reserveTask + transitionTask", () => {
  beforeEach(() => {
    marketClear();
  });

  describe("reserveTask", () => {
    it("reserves a task from posted → claiming", () => {
      marketUpsert(makePostedTask("task-1"));
      const result = reserveTask("task-1", ["posted"], "claiming");
      expect(result.ok).toBe(true);
      const task = getTaskById("task-1");
      expect(task?.status).toBe("claiming");
    });

    it("fails to reserve when status doesn't match expected from", () => {
      marketUpsert(makePostedTask("task-1"));
      // First reserve succeeds
      reserveTask("task-1", ["posted"], "claiming");
      // Second reserve from "posted" fails — status is now "claiming"
      const result = reserveTask("task-1", ["posted"], "claiming");
      expect(result.ok).toBe(false);
      expect(result.currentStatus).toBe("claiming");
    });

    it("fails on non-existent task", () => {
      const result = reserveTask("nonexistent", ["posted"], "claiming");
      expect(result.ok).toBe(false);
      expect(result.currentStatus).toBe(null);
    });
  });

  describe("transitionTask", () => {
    it("commits from transitional to final state", () => {
      marketUpsert(makePostedTask("task-1"));
      reserveTask("task-1", ["posted"], "claiming");
      const result = transitionTask("task-1", ["claiming"], "claimed", {
        claimerDid: "did:hedera:claimer",
      });
      expect(result.ok).toBe(true);
      const task = getTaskById("task-1");
      expect(task?.status).toBe("claimed");
      expect(task?.claimerDid).toBe("did:hedera:claimer");
    });

    it("fails when from doesn't match current transitional state", () => {
      marketUpsert(makePostedTask("task-1"));
      reserveTask("task-1", ["posted"], "claiming");
      // Try to commit from "posted" — but status is "claiming"
      const result = transitionTask("task-1", ["posted"], "claimed");
      expect(result.ok).toBe(false);
      expect(result.currentStatus).toBe("claiming");
    });

    it("rolls back to original state when from matches transitional", () => {
      marketUpsert(makePostedTask("task-1"));
      reserveTask("task-1", ["posted"], "claiming");
      // Rollback: transition from "claiming" back to "posted"
      const result = transitionTask("task-1", ["claiming"], "posted", {
        claimerDid: undefined,
      });
      expect(result.ok).toBe(true);
      const task = getTaskById("task-1");
      expect(task?.status).toBe("posted");
    });
  });

  describe("Concurrency: parallel claims", () => {
    it("exactly 1 winner out of 50 parallel claims", async () => {
      marketUpsert(makePostedTask("task-concurrent-1"));

      let winners = 0;
      let losers = 0;

      const claims = Array.from({ length: 50 }, async () => {
        const reserve = reserveTask("task-concurrent-1", ["posted"], "claiming");
        if (!reserve.ok) {
          losers++;
          return;
        }
        // Simulate HCS I/O
        await hcsDelay();
        // Commit
        const commit = transitionTask("task-concurrent-1", ["claiming"], "claimed", {
          claimerDid: "did:hedera:claimer",
        });
        if (commit.ok) winners++;
        else losers++;
      });

      await Promise.all(claims);

      expect(winners).toBe(1);
      expect(losers).toBe(49);
      expect(getTaskById("task-concurrent-1")?.status).toBe("claimed");
    });

    it("exactly 1 winner out of 20 parallel complete operations", async () => {
      // Setup: task already claimed
      marketUpsert({ ...makePostedTask("task-concurrent-2"), status: "claimed" });

      let winners = 0;
      let losers = 0;

      const completes = Array.from({ length: 20 }, async () => {
        const reserve = reserveTask("task-concurrent-2", ["claimed"], "completing");
        if (!reserve.ok) {
          losers++;
          return;
        }
        await hcsDelay();
        const commit = transitionTask("task-concurrent-2", ["completing"], "completed", {
          paymentTxId: "0.0.5678",
        });
        if (commit.ok) winners++;
        else losers++;
      });

      await Promise.all(completes);

      expect(winners).toBe(1);
      expect(losers).toBe(19);
      expect(getTaskById("task-concurrent-2")?.status).toBe("completed");
    });

    it("interleaved complete + cancel → single victor", async () => {
      marketUpsert({ ...makePostedTask("task-concurrent-3"), status: "claimed" });

      let completeWins = 0;
      let cancelWins = 0;

      const operations = [
        ...Array.from({ length: 10 }, async () => {
          const r = reserveTask("task-concurrent-3", ["claimed"], "completing");
          if (!r.ok) return;
          await hcsDelay();
          const c = transitionTask("task-concurrent-3", ["completing"], "completed");
          if (c.ok) completeWins++;
        }),
        ...Array.from({ length: 10 }, async () => {
          const r = reserveTask("task-concurrent-3", ["claimed"], "cancelling");
          if (!r.ok) return;
          await hcsDelay();
          const c = transitionTask("task-concurrent-3", ["cancelling"], "cancelled");
          if (c.ok) cancelWins++;
        }),
      ];

      await Promise.all(operations);

      // Exactly one should win
      expect(completeWins + cancelWins).toBe(1);
      const task = getTaskById("task-concurrent-3");
      expect(["completed", "cancelled"]).toContain(task?.status);
    });

    it("reserve→crash (no commit)→rollback returns to original state", async () => {
      marketUpsert(makePostedTask("task-crash-1"));

      const reserve = reserveTask("task-crash-1", ["posted"], "claiming");
      expect(reserve.ok).toBe(true);
      // Simulate crash: no commit, no rollback
      // Task is stuck in "claiming"

      // Now a recovery operation rolls back from "claiming" to "posted"
      const rollback = transitionTask("task-crash-1", ["claiming"], "posted", {
        claimerDid: undefined,
      });
      expect(rollback.ok).toBe(true);
      expect(getTaskById("task-crash-1")?.status).toBe("posted");
    });
  });

  describe("Transitional states invisible to public reads", () => {
    it("listTasks excludes transitional states by default", () => {
      marketUpsert(makePostedTask("task-visible"));
      marketUpsert({ ...makePostedTask("task-hidden"), status: "claiming" });

      const { tasks } = listTasks();
      const ids = tasks.map((t) => t.taskId);
      expect(ids).toContain("task-visible");
      expect(ids).not.toContain("task-hidden");
    });
  });
});
