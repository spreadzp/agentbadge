import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TopicMessage } from "@agentbadge/hedera-core";

// Mock mirror.service before importing directoryCache
vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getTopicMessages: vi.fn(),
}));

import { getTopicMessages } from "@agentbadge/hedera-core";
import {
  upsert,
  getAll,
  get,
  clear,
  rebuildFromHcs,
  type DirectoryEntry,
} from "@agentbadge/passport";

const mockedGetTopicMessages = vi.mocked(getTopicMessages);

function makeMessage(timestamp: string, payload: Record<string, unknown>): TopicMessage {
  return {
    consensus_timestamp: timestamp,
    message: JSON.stringify(payload),
    sequence_number: 0,
    running_hash: "",
  };
}

function makeRegisterPayload(
  did: string,
  overrides: Partial<DirectoryEntry> = {},
): Record<string, unknown> {
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
    ...overrides,
  };
}

const TOPIC_ID = "0.0.9999999";

describe("rebuildFromHcs", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("populates cache from ordered HCS messages", async () => {
    const messages = [
      makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
      makeMessage("1700000001.000000001", makeRegisterPayload("did:hcs:0.0.123:2")),
    ];
    mockedGetTopicMessages.mockResolvedValueOnce(messages);

    await rebuildFromHcs(TOPIC_ID);

    const all = getAll();
    expect(all).toHaveLength(2);
    expect(get("did:hcs:0.0.123:1")).toBeDefined();
    expect(get("did:hcs:0.0.123:2")).toBeDefined();
  });

  it("last-write-wins for re-registration of same DID", async () => {
    const messages = [
      makeMessage(
        "1700000000.000000001",
        makeRegisterPayload("did:hcs:0.0.123:1", { name: "OldBot" }),
      ),
      makeMessage(
        "1700000005.000000001",
        makeRegisterPayload("did:hcs:0.0.123:1", { name: "NewBot" }),
      ),
    ];
    mockedGetTopicMessages.mockResolvedValueOnce(messages);

    await rebuildFromHcs(TOPIC_ID);

    const entry = get("did:hcs:0.0.123:1");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("NewBot");
    expect(getAll()).toHaveLength(1);
  });

  it("processes messages in consensus_timestamp order regardless of fetch order", async () => {
    // Mirror Node returns desc order by default; rebuild must sort ascending
    const messages = [
      makeMessage(
        "1700000005.000000001",
        makeRegisterPayload("did:hcs:0.0.123:1", { name: "Later" }),
      ),
      makeMessage(
        "1700000000.000000001",
        makeRegisterPayload("did:hcs:0.0.123:1", { name: "Earlier" }),
      ),
    ];
    mockedGetTopicMessages.mockResolvedValueOnce(messages);

    await rebuildFromHcs(TOPIC_ID);

    const entry = get("did:hcs:0.0.123:1");
    expect(entry!.name).toBe("Later");
  });

  it("atomically replaces cache — old entries cleared", async () => {
    upsert({
      did: "did:hcs:0.0.999:1",
      tokenId: "0.0.999",
      serial: 1,
      accountId: "0.0.111",
      name: "Stale",
      capabilities: ["api_call"],
      endpoint: "https://stale",
      tier: "bronze",
      timestamp: 0,
    });
    expect(getAll()).toHaveLength(1);

    mockedGetTopicMessages.mockResolvedValueOnce([
      makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
    ]);

    await rebuildFromHcs(TOPIC_ID);

    expect(get("did:hcs:0.0.999:1")).toBeUndefined();
    expect(get("did:hcs:0.0.123:1")).toBeDefined();
  });

  it("retries on Mirror Node failure with exponential backoff", async () => {
    mockedGetTopicMessages
      .mockRejectedValueOnce(new Error("Mirror Node error 503"))
      .mockRejectedValueOnce(new Error("Mirror Node error 503"))
      .mockResolvedValueOnce([
        makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
      ]);

    const promise = rebuildFromHcs(TOPIC_ID, { maxAttempts: 3, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100 + 200);
    await promise;

    expect(mockedGetTopicMessages).toHaveBeenCalledTimes(3);
    expect(get("did:hcs:0.0.123:1")).toBeDefined();
  });

  it("throws after max attempts exhausted", async () => {
    mockedGetTopicMessages.mockRejectedValue(new Error("Mirror Node error 503"));

    const promise = rebuildFromHcs(TOPIC_ID, { maxAttempts: 2, baseDelayMs: 100 });
    // Attach rejection handler immediately to prevent unhandled rejection
    const assertion = expect(promise).rejects.toThrow(/Mirror Node error 503/);
    await vi.advanceTimersByTimeAsync(100 + 200);
    await assertion;
    expect(mockedGetTopicMessages).toHaveBeenCalledTimes(2);
  });

  it("skips non-agent_register messages gracefully", async () => {
    const messages = [
      makeMessage("1700000000.000000001", { type: "agent_deregister", did: "did:hcs:0.0.123:1" }),
      makeMessage("1700000001.000000001", makeRegisterPayload("did:hcs:0.0.123:2")),
    ];
    mockedGetTopicMessages.mockResolvedValueOnce(messages);

    await rebuildFromHcs(TOPIC_ID);

    expect(get("did:hcs:0.0.123:1")).toBeUndefined();
    expect(get("did:hcs:0.0.123:2")).toBeDefined();
    expect(getAll()).toHaveLength(1);
  });

  it("handles empty topic (no messages)", async () => {
    mockedGetTopicMessages.mockResolvedValueOnce([]);

    await rebuildFromHcs(TOPIC_ID);

    expect(getAll()).toHaveLength(0);
  });
});
