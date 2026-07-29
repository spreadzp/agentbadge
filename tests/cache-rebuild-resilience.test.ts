import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TopicMessage } from "@agentgate-hedera/hedera-core";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getTopicMessages: vi.fn(),
}));

import { getTopicMessages } from "@agentgate-hedera/hedera-core";
import {
  clear,
  getAll,
  startBackgroundRebuild,
  stopBackgroundRebuild,
} from "@agentgate-hedera/passport";

const mockedGetTopicMessages = vi.mocked(getTopicMessages);

function makeMessage(timestamp: string, payload: Record<string, unknown>): TopicMessage {
  return {
    consensus_timestamp: timestamp,
    message: JSON.stringify(payload),
    sequence_number: 0,
    running_hash: "",
  };
}

function makeRegisterPayload(did: string): Record<string, unknown> {
  return {
    type: "agent_register",
    did,
    tokenId: "0.0.1234567",
    serial: 1,
    accountId: "0.0.7654321",
    name: "TestBot",
    capabilities: ["api_call"],
    endpoint: "https://agent.test",
    tier: "bronze",
    timestamp: Math.floor(Date.now() / 1000),
  };
}

const TOPIC_ID = "0.0.9999999";

describe("startBackgroundRebuild — SLICE-7-2", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopBackgroundRebuild();
    vi.useRealTimers();
  });

  it("does not throw when Mirror Node is unavailable", () => {
    mockedGetTopicMessages.mockRejectedValue(new Error("Mirror Node 503"));

    expect(() => startBackgroundRebuild(TOPIC_ID, { maxAttempts: 1 })).not.toThrow();
  });

  it("starts with empty cache when rebuild fails", () => {
    mockedGetTopicMessages.mockRejectedValue(new Error("Mirror Node 503"));

    startBackgroundRebuild(TOPIC_ID, { maxAttempts: 1 });

    expect(getAll()).toHaveLength(0);
  });

  it("logs warning when initial rebuild fails", async () => {
    mockedGetTopicMessages.mockRejectedValue(new Error("Mirror Node 503"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    startBackgroundRebuild(TOPIC_ID, { maxAttempts: 1 });

    // Flush microtasks for async attemptRebuild to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("cache rebuild failed"));
    warnSpy.mockRestore();
  });

  it("retries periodically until successful", async () => {
    mockedGetTopicMessages
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce([
        makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
      ]);

    startBackgroundRebuild(TOPIC_ID, { retryDelayMs: 5000, maxAttempts: 1 });

    // First attempt fails immediately
    expect(getAll()).toHaveLength(0);

    // Wait for retry 1
    await vi.advanceTimersByTimeAsync(5000);
    expect(getAll()).toHaveLength(0);

    // Wait for retry 2 — succeeds
    await vi.advanceTimersByTimeAsync(5000);
    expect(getAll()).toHaveLength(1);
    expect(mockedGetTopicMessages).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after successful rebuild", async () => {
    mockedGetTopicMessages.mockResolvedValue([
      makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
    ]);

    startBackgroundRebuild(TOPIC_ID, { retryDelayMs: 5000, maxAttempts: 1 });

    await vi.advanceTimersByTimeAsync(100);
    expect(getAll()).toHaveLength(1);
    expect(mockedGetTopicMessages).toHaveBeenCalledTimes(1);

    // Advance past several retry intervals — no more calls
    await vi.advanceTimersByTimeAsync(20000);
    expect(mockedGetTopicMessages).toHaveBeenCalledTimes(1);
  });

  it("logs success after eventual rebuild", async () => {
    mockedGetTopicMessages
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce([
        makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
      ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    startBackgroundRebuild(TOPIC_ID, { retryDelayMs: 5000, maxAttempts: 1 });

    await vi.advanceTimersByTimeAsync(5000);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("rebuilt"));

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
