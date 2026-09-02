import { describe, it, expect, beforeEach } from "vitest";
import {
  isValidTaskMessage,
  type TaskPostedMessage,
  type TaskClaimedMessage,
  type TaskDeliveredMessage,
  type TaskCompletedMessage,
} from "@agentbadge/hedera-core";

describe("isValidTaskMessage", () => {
  const posted: TaskPostedMessage = {
    type: "task_posted",
    taskId: "task-abc-123",
    posterDid: "did:hcs:0.0.123:1",
    title: "Data Analysis Task",
    description: "Analyze the dataset",
    priceHbar: 10,
    capabilities: ["data_analysis", "api_call"],
    timestamp: 1700000000,
  };

  const claimed: TaskClaimedMessage = {
    type: "task_claimed",
    taskId: "task-abc-123",
    claimerDid: "did:hcs:0.0.456:2",
    timestamp: 1700000001,
  };

  const delivered: TaskDeliveredMessage = {
    type: "task_delivered",
    taskId: "task-abc-123",
    resultBody: "Analysis complete",
    timestamp: 1700000002,
  };

  const completed: TaskCompletedMessage = {
    type: "task_completed",
    taskId: "task-abc-123",
    paymentTxId: "0.0.2@1700000000.000000001",
    timestamp: 1700000003,
  };

  it("accepts a valid task_posted message", () => {
    expect(isValidTaskMessage(posted)).toBe(true);
  });

  it("accepts a valid task_posted with optional deadline", () => {
    expect(isValidTaskMessage({ ...posted, deadline: 1700100000 })).toBe(true);
  });

  it("accepts a valid task_claimed message", () => {
    expect(isValidTaskMessage(claimed)).toBe(true);
  });

  it("accepts a valid task_delivered message", () => {
    expect(isValidTaskMessage(delivered)).toBe(true);
  });

  it("accepts a valid task_delivered with resultIpfs", () => {
    expect(isValidTaskMessage({ ...delivered, resultIpfs: "bafy..." })).toBe(true);
  });

  it("accepts a valid task_completed message", () => {
    expect(isValidTaskMessage(completed)).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidTaskMessage(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidTaskMessage("string")).toBe(false);
    expect(isValidTaskMessage(42)).toBe(false);
    expect(isValidTaskMessage(undefined)).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isValidTaskMessage({ ...posted, type: "unknown_type" })).toBe(false);
  });

  it("rejects task_posted missing posterDid", () => {
    const { posterDid: _pd, ...rest } = posted;
    expect(isValidTaskMessage(rest)).toBe(false);
  });

  it("rejects task_posted missing title", () => {
    const { title: _t, ...rest } = posted;
    expect(isValidTaskMessage(rest)).toBe(false);
  });

  it("rejects task_posted with non-array capabilities", () => {
    expect(isValidTaskMessage({ ...posted, capabilities: "data_analysis" })).toBe(false);
  });

  it("rejects task_posted with non-string in capabilities", () => {
    expect(isValidTaskMessage({ ...posted, capabilities: ["valid", 123] })).toBe(false);
  });

  it("rejects task_posted with non-number priceHbar", () => {
    expect(isValidTaskMessage({ ...posted, priceHbar: "10" })).toBe(false);
  });

  it("rejects task_claimed missing claimerDid", () => {
    const { claimerDid: _cd, ...rest } = claimed;
    expect(isValidTaskMessage(rest)).toBe(false);
  });

  it("rejects task_completed missing paymentTxId", () => {
    const { paymentTxId: _ptx, ...rest } = completed;
    expect(isValidTaskMessage(rest)).toBe(false);
  });

  it("rejects message missing taskId", () => {
    const { taskId: _tid, ...rest } = posted;
    expect(isValidTaskMessage(rest)).toBe(false);
  });

  it("rejects message missing timestamp", () => {
    const { timestamp: _ts, ...rest } = posted;
    expect(isValidTaskMessage(rest)).toBe(false);
  });

  it("rejects task_delivered with non-string resultIpfs", () => {
    expect(isValidTaskMessage({ ...delivered, resultIpfs: 123 })).toBe(false);
  });
});

describe("submitTaskMessage (mock)", () => {
  beforeEach(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.MARKET_TOPIC_ID = "0.0.888";
  });

  it("submits a task_posted message and returns a transaction ID", async () => {
    const { submitTaskMessage } = await import("@agentbadge/hedera-core");
    const message: TaskPostedMessage = {
      type: "task_posted",
      taskId: "test-task-1",
      posterDid: "did:hcs:0.0.123:1",
      title: "Test Task",
      description: "A test marketplace task",
      priceHbar: 5,
      capabilities: ["api_call"],
      timestamp: Math.floor(Date.now() / 1000),
    };

    const txId = await submitTaskMessage(message);
    expect(typeof txId).toBe("string");
    expect(txId).toContain("@");
  });

  it("persists message to mock topic store for retrieval", async () => {
    const { submitTaskMessage, getTopicMessages } = await import("@agentbadge/hedera-core");
    const message: TaskPostedMessage = {
      type: "task_posted",
      taskId: "test-task-2",
      posterDid: "did:hcs:0.0.123:1",
      title: "Persistence Test",
      description: "Verify message is stored",
      priceHbar: 15,
      capabilities: ["data_analysis"],
      timestamp: Math.floor(Date.now() / 1000),
    };

    await submitTaskMessage(message);
    const msgs = await getTopicMessages("0.0.888");
    expect(msgs.length).toBeGreaterThan(0);
    const last = msgs[0];
    const parsed = JSON.parse(last.message);
    expect(parsed.type).toBe("task_posted");
    expect(parsed.taskId).toBe("test-task-2");
  });

  it("submits all 4 message types", async () => {
    const { submitTaskMessage, getTaskMessages } = await import("@agentbadge/hedera-core");
    const ts = Math.floor(Date.now() / 1000);

    await submitTaskMessage({
      type: "task_posted",
      taskId: "multi-1",
      posterDid: "did:hcs:0.0.123:1",
      title: "Multi-type test",
      description: "Testing all 4 types",
      priceHbar: 3,
      capabilities: ["api_call"],
      timestamp: ts,
    });
    await submitTaskMessage({
      type: "task_claimed",
      taskId: "multi-1",
      claimerDid: "did:hcs:0.0.456:2",
      timestamp: ts + 1,
    });
    await submitTaskMessage({
      type: "task_delivered",
      taskId: "multi-1",
      resultBody: "Done",
      timestamp: ts + 2,
    });
    await submitTaskMessage({
      type: "task_completed",
      taskId: "multi-1",
      paymentTxId: "0.0.2@1700000000.000000001",
      timestamp: ts + 3,
    });

    const tasks = await getTaskMessages("0.0.888");
    const multiTasks = tasks.filter((t) => t.message.taskId === "multi-1");
    expect(multiTasks.length).toBe(4);
    const types = multiTasks.map((t) => t.message.type);
    expect(types).toContain("task_posted");
    expect(types).toContain("task_claimed");
    expect(types).toContain("task_delivered");
    expect(types).toContain("task_completed");
  });
});

describe("getTaskMessages (mock)", () => {
  beforeEach(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.MARKET_TOPIC_ID = "0.0.888";
  });

  it("filters out invalid messages", async () => {
    const { submitTaskMessage, getTaskMessages, getTopicMessages } = await import(
      "@agentbadge/hedera-core"
    );

    // Submit a valid task message
    await submitTaskMessage({
      type: "task_posted",
      taskId: "valid-1",
      posterDid: "did:hcs:0.0.123:1",
      title: "Valid Task",
      description: "This is valid",
      priceHbar: 5,
      capabilities: ["api_call"],
      timestamp: Math.floor(Date.now() / 1000),
    });

    // Manually push an invalid message to the topic store
    const { topicMessages } = await import("@agentbadge/hedera-core");
    const msgs = topicMessages.get("0.0.888") ?? [];
    msgs.push({
      consensus_timestamp: "9999999999.000000001",
      message: JSON.stringify({ type: "unknown", taskId: "bad" }),
      sequence_number: 999,
      running_hash: "mock_hash_999",
    });
    topicMessages.set("0.0.888", msgs);

    const tasks = await getTaskMessages("0.0.888");
    const invalidTasks = tasks.filter((t) => (t.message as { type: string }).type === "unknown");
    expect(invalidTasks.length).toBe(0);
  });

  it("returns empty array for topic with no messages", async () => {
    const { getTaskMessages } = await import("@agentbadge/hedera-core");
    const tasks = await getTaskMessages("0.0.999");
    expect(tasks).toEqual([]);
  });
});
