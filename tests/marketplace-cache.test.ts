import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TaskMessage, TaskMessageWithTx, CachedMarketTask } from "@agentgate-hedera/hedera-core";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getTaskMessages: vi.fn(),
}));

import { getTaskMessages } from "@agentgate-hedera/hedera-core";
import {
  marketUpsert as upsert,
  marketGet as get,
  getTaskById,
  marketGetAll as getAll,
  getActiveTasks,
  getTasksByCapability,
  updateTaskStatus,
  listTasks,
  marketClear as clear,
  marketRebuildFromHcs as rebuildFromHcs,
  marketStartBackgroundRebuild as startBackgroundRebuild,
  marketStopBackgroundRebuild as stopBackgroundRebuild,
} from "@agentgate-hedera/passport";

const mockedGetTaskMessages = vi.mocked(getTaskMessages);

const TOPIC_ID = "0.0.888";

function makeTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-001",
    posterDid: "did:hcs:0.0.123:1",
    title: "Data Analysis Task",
    description: "Analyze the dataset",
    priceHbar: 10,
    capabilities: ["data_analysis", "api_call"],
    status: "posted",
    txId: "0.0.2@1700000000.000000001",
    consensusTimestamp: "1700000000.000000001",
    createdAt: 1700000000,
    ...overrides,
  };
}

function makeTaskMessage(
  timestamp: number,
  overrides: Partial<TaskMessage> & { type: TaskMessage["type"] },
): TaskMessageWithTx {
  return {
    message: {
      taskId: "task-001",
      timestamp,
      ...overrides,
    } as TaskMessage,
    txId: `0.0.2@${timestamp}.000000001`,
  };
}

describe("marketplaceCache", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
  });

  describe("upsert + get", () => {
    it("adds task to cache and retrieves it", () => {
      const task = makeTask();
      upsert(task);
      expect(get("task-001")).toEqual(task);
    });

    it("upsert with same taskId overwrites", () => {
      upsert(makeTask({ title: "first" }));
      upsert(makeTask({ title: "second" }));
      expect(get("task-001")?.title).toBe("second");
    });

    it("get returns undefined for missing task", () => {
      expect(get("nonexistent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("returns all tasks sorted newest first", () => {
      upsert(makeTask({ taskId: "t1", createdAt: 100 }));
      upsert(makeTask({ taskId: "t2", createdAt: 200 }));
      upsert(makeTask({ taskId: "t3", createdAt: 150 }));

      const all = getAll();
      expect(all).toHaveLength(3);
      expect(all[0].taskId).toBe("t2");
      expect(all[1].taskId).toBe("t3");
      expect(all[2].taskId).toBe("t1");
    });

    it("returns empty array when cache is empty", () => {
      expect(getAll()).toEqual([]);
    });
  });

  describe("getActiveTasks", () => {
    it("filters out completed tasks", () => {
      upsert(makeTask({ taskId: "t1", status: "posted" }));
      upsert(makeTask({ taskId: "t2", status: "completed" }));
      upsert(makeTask({ taskId: "t3", status: "claimed" }));

      const active = getActiveTasks();
      expect(active).toHaveLength(2);
      expect(active.map((t) => t.taskId)).toContain("t1");
      expect(active.map((t) => t.taskId)).toContain("t3");
      expect(active.map((t) => t.taskId)).not.toContain("t2");
    });
  });

  describe("getTasksByCapability", () => {
    it("returns only active tasks with matching capability", () => {
      upsert(makeTask({ taskId: "t1", capabilities: ["data_analysis"] }));
      upsert(makeTask({ taskId: "t2", capabilities: ["code_review"] }));
      upsert(makeTask({ taskId: "t3", capabilities: ["data_analysis"], status: "completed" }));

      const result = getTasksByCapability("data_analysis");
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe("t1");
    });

    it("returns empty array when no tasks match", () => {
      upsert(makeTask({ capabilities: ["code_review"] }));
      expect(getTasksByCapability("data_analysis")).toEqual([]);
    });
  });

  describe("updateTaskStatus", () => {
    it("transitions posted → claimed", () => {
      upsert(makeTask({ status: "posted" }));
      const result = updateTaskStatus("task-001", "claimed", { claimerDid: "did:hcs:0.0.456:2" });
      expect(result).toBe(true);
      expect(get("task-001")?.status).toBe("claimed");
      expect(get("task-001")?.claimerDid).toBe("did:hcs:0.0.456:2");
    });

    it("transitions claimed → delivered", () => {
      upsert(makeTask({ status: "claimed", claimerDid: "did:hcs:0.0.456:2" }));
      const result = updateTaskStatus("task-001", "delivered", { resultBody: "Done" });
      expect(result).toBe(true);
      expect(get("task-001")?.status).toBe("delivered");
      expect(get("task-001")?.resultBody).toBe("Done");
    });

    it("transitions delivered → completed", () => {
      upsert(makeTask({ status: "delivered", resultBody: "Done" }));
      const result = updateTaskStatus("task-001", "completed", { paymentTxId: "0.0.2@tx" });
      expect(result).toBe(true);
      expect(get("task-001")?.status).toBe("completed");
      expect(get("task-001")?.paymentTxId).toBe("0.0.2@tx");
    });

    it("rejects invalid transition posted → delivered", () => {
      upsert(makeTask({ status: "posted" }));
      const result = updateTaskStatus("task-001", "delivered");
      expect(result).toBe(false);
      expect(get("task-001")?.status).toBe("posted");
    });

    it("rejects invalid transition completed → posted", () => {
      upsert(makeTask({ status: "completed" }));
      const result = updateTaskStatus("task-001", "posted");
      expect(result).toBe(false);
    });

    it("returns false for non-existent task", () => {
      expect(updateTaskStatus("nonexistent", "claimed")).toBe(false);
    });
  });

  describe("listTasks", () => {
    it("returns tasks with pagination", () => {
      for (let i = 0; i < 10; i++) {
        upsert(makeTask({ taskId: `t${i}`, createdAt: 100 + i }));
      }

      const result = listTasks({ limit: 3, offset: 2 });
      expect(result.tasks).toHaveLength(3);
      expect(result.total).toBe(10);
      expect(result.tasks[0].taskId).toBe("t7"); // newest first, offset 2
    });

    it("filters by capability", () => {
      upsert(makeTask({ taskId: "t1", capabilities: ["data_analysis"] }));
      upsert(makeTask({ taskId: "t2", capabilities: ["code_review"] }));
      upsert(makeTask({ taskId: "t3", capabilities: ["data_analysis"] }));

      const result = listTasks({ capability: "data_analysis" });
      expect(result.tasks).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("uses default limit and offset", () => {
      upsert(makeTask());
      const result = listTasks();
      expect(result.tasks).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("clear", () => {
    it("wipes the cache", () => {
      upsert(makeTask());
      expect(getAll()).toHaveLength(1);
      clear();
      expect(getAll()).toHaveLength(0);
    });
  });

  describe("rebuildFromHcs", () => {
    it("populates cache from HCS task messages", async () => {
      const messages: TaskMessageWithTx[] = [
        makeTaskMessage(1700000000, {
          type: "task_posted",
          taskId: "task-a",
          posterDid: "did:hcs:0.0.123:1",
          title: "Task A",
          description: "Description A",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
        makeTaskMessage(1700000001, {
          type: "task_posted",
          taskId: "task-b",
          posterDid: "did:hcs:0.0.123:2",
          title: "Task B",
          description: "Description B",
          priceHbar: 10,
          capabilities: ["data_analysis"],
        }),
      ];
      mockedGetTaskMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);

      expect(getAll()).toHaveLength(2);
      expect(get("task-a")?.title).toBe("Task A");
      expect(get("task-b")?.title).toBe("Task B");
    });

    it("applies task_claimed message to existing task", async () => {
      const messages: TaskMessageWithTx[] = [
        makeTaskMessage(1700000000, {
          type: "task_posted",
          taskId: "task-a",
          posterDid: "did:hcs:0.0.123:1",
          title: "Task A",
          description: "Description A",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
        makeTaskMessage(1700000001, {
          type: "task_claimed",
          taskId: "task-a",
          claimerDid: "did:hcs:0.0.456:2",
        }),
      ];
      mockedGetTaskMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);

      const task = get("task-a");
      expect(task?.status).toBe("claimed");
      expect(task?.claimerDid).toBe("did:hcs:0.0.456:2");
    });

    it("applies full lifecycle: posted → claimed → delivered → completed", async () => {
      const messages: TaskMessageWithTx[] = [
        makeTaskMessage(1700000000, {
          type: "task_posted",
          taskId: "task-x",
          posterDid: "did:hcs:0.0.123:1",
          title: "Task X",
          description: "Full lifecycle",
          priceHbar: 20,
          capabilities: ["api_call"],
        }),
        makeTaskMessage(1700000001, {
          type: "task_claimed",
          taskId: "task-x",
          claimerDid: "did:hcs:0.0.456:2",
        }),
        makeTaskMessage(1700000002, {
          type: "task_delivered",
          taskId: "task-x",
          resultBody: "Result here",
        }),
        makeTaskMessage(1700000003, {
          type: "task_completed",
          taskId: "task-x",
          paymentTxId: "0.0.2@1700000000.000000001",
        }),
      ];
      mockedGetTaskMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);

      const task = get("task-x");
      expect(task?.status).toBe("completed");
      expect(task?.claimerDid).toBe("did:hcs:0.0.456:2");
      expect(task?.resultBody).toBe("Result here");
      expect(task?.paymentTxId).toBe("0.0.2@1700000000.000000001");
    });

    it("skips non-task message types (getTaskMessages already filters)", async () => {
      const messages: TaskMessageWithTx[] = [
        makeTaskMessage(1700000001, {
          type: "task_posted",
          taskId: "task-valid",
          posterDid: "did:hcs:0.0.123:1",
          title: "Valid",
          description: "Valid task",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
      ];
      mockedGetTaskMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(1);
    });

    it("handles empty message list", async () => {
      mockedGetTaskMessages.mockResolvedValueOnce([]);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(0);
    });

    it("retries on failure with exponential backoff", async () => {
      mockedGetTaskMessages
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce([]);

      await rebuildFromHcs(TOPIC_ID, { maxAttempts: 3, baseDelayMs: 10 });
      expect(mockedGetTaskMessages).toHaveBeenCalledTimes(3);
    });

    it("throws after max attempts", async () => {
      mockedGetTaskMessages.mockRejectedValue(new Error("Persistent error"));

      await expect(
        rebuildFromHcs(TOPIC_ID, { maxAttempts: 2, baseDelayMs: 10 }),
      ).rejects.toThrow("Persistent error");
      expect(mockedGetTaskMessages).toHaveBeenCalledTimes(2);
    });

    it("full rebuild clears cache first", async () => {
      upsert(makeTask({ taskId: "old-task", title: "Old" }));

      mockedGetTaskMessages.mockResolvedValueOnce([
        makeTaskMessage(1700000001, {
          type: "task_posted",
          taskId: "new-task",
          posterDid: "did:hcs:0.0.123:1",
          title: "New",
          description: "New task",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
      ]);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(1);
      expect(get("old-task")).toBeUndefined();
      expect(get("new-task")?.title).toBe("New");
    });

    it("incremental rebuild merges with existing cache", async () => {
      upsert(makeTask({ taskId: "existing-task", title: "Existing" }));

      mockedGetTaskMessages.mockResolvedValueOnce([
        makeTaskMessage(1700000001, {
          type: "task_posted",
          taskId: "new-task",
          posterDid: "did:hcs:0.0.123:1",
          title: "New",
          description: "New task",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
      ]);

      await rebuildFromHcs(TOPIC_ID, { incremental: true });
      expect(getAll()).toHaveLength(2);
      expect(get("existing-task")?.title).toBe("Existing");
      expect(get("new-task")?.title).toBe("New");
    });

    it("ignores task_claimed for non-existent task", async () => {
      mockedGetTaskMessages.mockResolvedValueOnce([
        makeTaskMessage(1700000001, {
          type: "task_claimed",
          taskId: "ghost-task",
          claimerDid: "did:hcs:0.0.456:2",
        }),
      ]);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(0);
    });

    it("ignores task_delivered for task in posted status (wrong order)", async () => {
      const messages: TaskMessageWithTx[] = [
        makeTaskMessage(1700000000, {
          type: "task_posted",
          taskId: "task-y",
          posterDid: "did:hcs:0.0.123:1",
          title: "Task Y",
          description: "Test",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
        makeTaskMessage(1700000001, {
          type: "task_delivered",
          taskId: "task-y",
          resultBody: "Skipped",
        }),
      ];
      mockedGetTaskMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);
      const task = get("task-y");
      expect(task?.status).toBe("posted");
      expect(task?.resultBody).toBeUndefined();
    });
  });

  describe("getTaskById", () => {
    it("returns task by id", () => {
      upsert(makeTask({ taskId: "task-x" }));
      expect(getTaskById("task-x")?.title).toBe("Data Analysis Task");
    });

    it("returns null for missing task", () => {
      expect(getTaskById("nonexistent")).toBeNull();
    });
  });

  describe("startBackgroundRebuild", () => {
    afterEach(() => {
      stopBackgroundRebuild();
    });

    it("starts non-blocking rebuild and populates cache", async () => {
      mockedGetTaskMessages.mockResolvedValueOnce([
        makeTaskMessage(1700000001, {
          type: "task_posted",
          taskId: "bg-task",
          posterDid: "did:hcs:0.0.123:1",
          title: "Background",
          description: "BG task",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
      ]);

      startBackgroundRebuild(TOPIC_ID, { retryDelayMs: 100 });

      await vi.waitFor(() => {
        expect(getAll()).toHaveLength(1);
        expect(get("bg-task")?.title).toBe("Background");
      });
    });

    it("retries on failure", async () => {
      mockedGetTaskMessages
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce([
          makeTaskMessage(1700000001, {
            type: "task_posted",
            taskId: "retry-task",
            posterDid: "did:hcs:0.0.123:1",
            title: "Retry",
            description: "Retry task",
            priceHbar: 5,
            capabilities: ["api_call"],
          }),
        ]);

      startBackgroundRebuild(TOPIC_ID, { retryDelayMs: 50, maxAttempts: 1 });

      await vi.waitFor(() => {
        expect(getAll()).toHaveLength(1);
        expect(get("retry-task")?.title).toBe("Retry");
      });
    });
  });

  describe("performance", () => {
    it("getActiveTasks with 1000 tasks completes in <100ms", () => {
      for (let i = 0; i < 1000; i++) {
        upsert(
          makeTask({
            taskId: `perf-${i}`,
            createdAt: 1000000 + i,
            capabilities: i % 2 === 0 ? ["api_call"] : ["data_analysis"],
            status: i % 5 === 0 ? "completed" : "posted",
          }),
        );
      }

      const start = performance.now();
      const active = getActiveTasks();
      const elapsed = performance.now() - start;

      expect(active.length).toBe(800);
      expect(elapsed).toBeLessThan(100);
    });

    it("getTasksByCapability with 1000 tasks completes in <100ms", () => {
      for (let i = 0; i < 1000; i++) {
        upsert(
          makeTask({
            taskId: `cap-${i}`,
            createdAt: 2000000 + i,
            capabilities: i % 2 === 0 ? ["api_call"] : ["data_analysis"],
            status: "posted",
          }),
        );
      }

      const start = performance.now();
      const result = getTasksByCapability("api_call");
      const elapsed = performance.now() - start;

      expect(result.length).toBe(500);
      expect(elapsed).toBeLessThan(100);
    });
  });
});
