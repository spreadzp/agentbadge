import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskMessageWithTx, CachedMarketTask } from "@agentbadge/hedera-core";

// Mock getTaskMessages — the passport bundle imports it externally from hedera-core.
vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getTaskMessages: vi.fn(),
}));

import { getTaskMessages } from "@agentbadge/hedera-core";
import {
  marketClear,
  marketUpsert,
  marketGet,
  updateTaskStatus,
  marketRebuildFromHcs,
} from "@agentbadge/passport";

const mockedGetTaskMessages = vi.mocked(getTaskMessages);

const TOPIC_ID = "0.0.888";

function makePostedMsg(taskId: string, txId: string): TaskMessageWithTx {
  return {
    message: {
      type: "task_posted",
      taskId,
      posterDid: "did:hcs:0.0.123:1",
      title: "Test Task",
      description: "Test Description",
      priceHbar: 10,
      capabilities: ["data_analysis"],
      timestamp: Math.floor(Date.now() / 1000),
    },
    txId,
  };
}

function makeClaimedMsg(taskId: string, txId: string, claimerDid: string): TaskMessageWithTx {
  return {
    message: {
      type: "task_claimed",
      taskId,
      claimerDid,
      timestamp: Math.floor(Date.now() / 1000) + 1,
    },
    txId,
  };
}

function makeDeliveredMsg(taskId: string, txId: string, resultBody: string): TaskMessageWithTx {
  return {
    message: {
      type: "task_delivered",
      taskId,
      resultBody,
      timestamp: Math.floor(Date.now() / 1000) + 2,
    },
    txId,
  };
}

function makeCompletedMsg(taskId: string, txId: string, paymentTxId: string): TaskMessageWithTx {
  return {
    message: {
      type: "task_completed",
      taskId,
      paymentTxId,
      timestamp: Math.floor(Date.now() / 1000) + 3,
    },
    txId,
  };
}

describe("SLICE-TX-1: Task Transaction Trail", () => {
  beforeEach(() => {
    marketClear();
    vi.clearAllMocks();
  });

  describe("CachedMarketTask fields", () => {
    it("should accept claimTxId via updateTaskStatus", () => {
      const task: CachedMarketTask = {
        taskId: "task-test-1",
        posterDid: "did:hcs:0.0.123:1",
        title: "Test",
        description: "Desc",
        priceHbar: 5,
        capabilities: ["api_call"],
        status: "posted",
        txId: "0.0.2@100.000",
        consensusTimestamp: new Date().toISOString(),
        createdAt: Date.now(),
      };
      marketUpsert(task);

      const claimed = updateTaskStatus("task-test-1", "claimed", {
        claimerDid: "did:hcs:0.0.456:2",
        claimTxId: "0.0.2@101.000",
      });
      expect(claimed).toBe(true);

      const updated = marketGet("task-test-1");
      expect(updated).toBeDefined();
      expect(updated!.claimTxId).toBe("0.0.2@101.000");
    });

    it("should accept deliverTxId via updateTaskStatus", () => {
      const task: CachedMarketTask = {
        taskId: "task-test-2",
        posterDid: "did:hcs:0.0.123:1",
        title: "Test",
        description: "Desc",
        priceHbar: 5,
        capabilities: ["api_call"],
        status: "claimed",
        claimerDid: "did:hcs:0.0.456:2",
        txId: "0.0.2@100.000",
        claimTxId: "0.0.2@101.000",
        consensusTimestamp: new Date().toISOString(),
        createdAt: Date.now(),
      };
      marketUpsert(task);

      const delivered = updateTaskStatus("task-test-2", "delivered", {
        resultBody: "done",
        deliverTxId: "0.0.2@102.000",
      });
      expect(delivered).toBe(true);

      const updated = marketGet("task-test-2");
      expect(updated).toBeDefined();
      expect(updated!.deliverTxId).toBe("0.0.2@102.000");
    });

    it("should accept completedTxId via updateTaskStatus", () => {
      const task: CachedMarketTask = {
        taskId: "task-test-3",
        posterDid: "did:hcs:0.0.123:1",
        title: "Test",
        description: "Desc",
        priceHbar: 5,
        capabilities: ["api_call"],
        status: "delivered",
        txId: "0.0.2@100.000",
        claimTxId: "0.0.2@101.000",
        deliverTxId: "0.0.2@102.000",
        consensusTimestamp: new Date().toISOString(),
        createdAt: Date.now(),
      };
      marketUpsert(task);

      const completed = updateTaskStatus("task-test-3", "completed", {
        paymentTxId: "0.0.2@103.000",
        completedTxId: "0.0.2@104.000",
      });
      expect(completed).toBe(true);

      const updated = marketGet("task-test-3");
      expect(updated).toBeDefined();
      expect(updated!.completedTxId).toBe("0.0.2@104.000");
    });
  });

  describe("HCS rebuild preserves all 4 txIds", () => {
    it("should store all 4 txIds after rebuild from HCS messages", async () => {
      const taskId = "task-rebuild-1";
      const messages: TaskMessageWithTx[] = [
        makePostedMsg(taskId, "0.0.2@200.000"),
        makeClaimedMsg(taskId, "0.0.2@201.000", "did:hcs:0.0.456:2"),
        makeDeliveredMsg(taskId, "0.0.2@202.000", "result"),
        makeCompletedMsg(taskId, "0.0.2@203.000", "0.0.2@204.000"),
      ];

      mockedGetTaskMessages.mockResolvedValue(messages);

      await marketRebuildFromHcs(TOPIC_ID);

      const task = marketGet(taskId);
      expect(task).toBeDefined();
      expect(task!.status).toBe("completed");
      expect(task!.txId).toBe("0.0.2@200.000");
      expect(task!.claimTxId).toBe("0.0.2@201.000");
      expect(task!.deliverTxId).toBe("0.0.2@202.000");
      expect(task!.completedTxId).toBe("0.0.2@203.000");
      expect(task!.paymentTxId).toBe("0.0.2@204.000");
    });

    it("should store txId for posted task even without txId in message", async () => {
      const taskId = "task-rebuild-2";
      const msg = makePostedMsg(taskId, "");
      msg.txId = undefined;
      const messages: TaskMessageWithTx[] = [msg];

      mockedGetTaskMessages.mockResolvedValue(messages);

      await marketRebuildFromHcs(TOPIC_ID);

      const task = marketGet(taskId);
      expect(task).toBeDefined();
      expect(task!.status).toBe("posted");
      expect(task!.txId).toBe("");
    });

    it("should preserve txIds for partial lifecycle (posted + claimed only)", async () => {
      const taskId = "task-rebuild-3";
      const messages: TaskMessageWithTx[] = [
        makePostedMsg(taskId, "0.0.2@400.000"),
        makeClaimedMsg(taskId, "0.0.2@401.000", "did:hcs:0.0.456:2"),
      ];

      mockedGetTaskMessages.mockResolvedValue(messages);

      await marketRebuildFromHcs(TOPIC_ID);

      const task = marketGet(taskId);
      expect(task).toBeDefined();
      expect(task!.status).toBe("claimed");
      expect(task!.txId).toBe("0.0.2@400.000");
      expect(task!.claimTxId).toBe("0.0.2@401.000");
      expect(task!.deliverTxId).toBeUndefined();
      expect(task!.completedTxId).toBeUndefined();
    });
  });

  describe("Backward compatibility", () => {
    it("should work with tasks that have no claimTxId/deliverTxId (old data)", () => {
      const task: CachedMarketTask = {
        taskId: "task-old-1",
        posterDid: "did:hcs:0.0.123:1",
        title: "Old Task",
        description: "Old",
        priceHbar: 5,
        capabilities: ["api_call"],
        status: "posted",
        txId: "0.0.2@100.000",
        consensusTimestamp: new Date().toISOString(),
        createdAt: Date.now(),
      };
      marketUpsert(task);

      const retrieved = marketGet("task-old-1");
      expect(retrieved).toBeDefined();
      expect(retrieved!.claimTxId).toBeUndefined();
      expect(retrieved!.deliverTxId).toBeUndefined();
      expect(retrieved!.completedTxId).toBeUndefined();
    });
  });
});
