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
  upsert,
  rebuildFromHcs,
  startBackgroundRebuild,
  stopBackgroundRebuild,
  type DirectoryEntry,
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

function makeRegisterPayload(did: string, name?: string): Record<string, unknown> {
  return {
    type: "agent_register",
    did,
    tokenId: "0.0.1234567",
    serial: 1,
    accountId: "0.0.7654321",
    name: name ?? "TestBot",
    capabilities: ["api_call"],
    endpoint: "https://agent.test",
    tier: "bronze",
    timestamp: Math.floor(Date.now() / 1000),
  };
}

const TOPIC_ID = "0.0.9999999";

describe("Directory cache optimization — SLICE-7-10", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopBackgroundRebuild();
  });

  it("rebuildFromHcs with incremental=true fetches only recent messages", async () => {
    const now = Math.floor(Date.now() / 1000);
    const oldTs = `${now - 48 * 3600}.000000001`; // 48h ago
    const recentTs = `${now - 3600}.000000001`; // 1h ago

    mockedGetTopicMessages.mockResolvedValue([
      makeMessage(recentTs, makeRegisterPayload("did:hcs:0.0.123:1", "RecentBot")),
    ]);

    await rebuildFromHcs(TOPIC_ID, { incremental: true });

    expect(mockedGetTopicMessages).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({ startTime: expect.any(String) }),
    );
    expect(getAll()).toHaveLength(1);
    expect(getAll()[0].name).toBe("RecentBot");
  });

  it("rebuildFromHcs with incremental=true uses 24h cutoff by default", async () => {
    mockedGetTopicMessages.mockResolvedValue([]);

    await rebuildFromHcs(TOPIC_ID, { incremental: true });

    const callArg = mockedGetTopicMessages.mock.calls[0]?.[1];
    expect(callArg).toBeDefined();
    expect(callArg!.startTime).toBeDefined();

    // Verify the startTime is approximately 24h ago (within 5s tolerance)
    const expectedCutoff = Date.now() - 24 * 3600 * 1000;
    const actualCutoff = Date.parse(callArg!.startTime as string);
    expect(Math.abs(actualCutoff - expectedCutoff)).toBeLessThan(5000);
  });

  it("rebuildFromHcs with incremental=false (default) fetches all messages", async () => {
    mockedGetTopicMessages.mockResolvedValue([
      makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
    ]);

    await rebuildFromHcs(TOPIC_ID);

    // Should NOT pass startTime filter
    const callArg = mockedGetTopicMessages.mock.calls[0]?.[1];
    expect(callArg).toBeUndefined();
  });

  it("incremental rebuild merges with existing cache entries", async () => {
    // Pre-populate cache with an old entry
    const oldEntry: DirectoryEntry = {
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.1234567",
      serial: 1,
      accountId: "0.0.7654321",
      name: "OldBot",
      capabilities: ["api_call"],
      endpoint: "https://agent.test",
      tier: "bronze",
      timestamp: Math.floor(Date.now() / 1000) - 48 * 3600,
    };
    upsert(oldEntry);

    const recentTs = `${Math.floor(Date.now() / 1000) - 3600}.000000001`;
    mockedGetTopicMessages.mockResolvedValue([
      makeMessage(recentTs, makeRegisterPayload("did:hcs:0.0.456:2", "NewBot")),
    ]);

    await rebuildFromHcs(TOPIC_ID, { incremental: true });

    // Should have both old and new entries
    expect(getAll()).toHaveLength(2);
    const names = getAll()
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(["NewBot", "OldBot"]);
  });

  it("incremental rebuild updates existing entry if newer message found", async () => {
    // Pre-populate with old entry
    const oldEntry: DirectoryEntry = {
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.1234567",
      serial: 1,
      accountId: "0.0.7654321",
      name: "OldName",
      capabilities: ["api_call"],
      endpoint: "https://agent.test",
      tier: "bronze",
      timestamp: Math.floor(Date.now() / 1000) - 48 * 3600,
    };
    upsert(oldEntry);

    const recentTs = `${Math.floor(Date.now() / 1000) - 3600}.000000001`;
    mockedGetTopicMessages.mockResolvedValue([
      makeMessage(recentTs, { ...makeRegisterPayload("did:hcs:0.0.123:1"), name: "UpdatedName" }),
    ]);

    await rebuildFromHcs(TOPIC_ID, { incremental: true });

    expect(getAll()).toHaveLength(1);
    expect(getAll()[0].name).toBe("UpdatedName");
  });

  it("startBackgroundRebuild with incremental=true passes startTime to getTopicMessages", async () => {
    vi.useFakeTimers();
    mockedGetTopicMessages.mockResolvedValue([
      makeMessage(
        `${Math.floor(Date.now() / 1000) - 100}.000000001`,
        makeRegisterPayload("did:hcs:0.0.123:1"),
      ),
    ]);

    startBackgroundRebuild(TOPIC_ID, { incremental: true, maxAttempts: 1 });
    await vi.advanceTimersByTimeAsync(100);

    const callArg = mockedGetTopicMessages.mock.calls[0]?.[1];
    expect(callArg).toBeDefined();
    expect(callArg!.startTime).toBeDefined();
    vi.useRealTimers();
  });

  it("full rebuild clears cache before repopulating", async () => {
    upsert({
      did: "did:hcs:0.0.999:9",
      tokenId: "0.0.999",
      serial: 9,
      accountId: "0.0.999",
      name: "StaleBot",
      capabilities: [],
      endpoint: "",
      tier: "bronze",
      timestamp: 0,
    });

    mockedGetTopicMessages.mockResolvedValue([
      makeMessage("1700000000.000000001", makeRegisterPayload("did:hcs:0.0.123:1")),
    ]);

    await rebuildFromHcs(TOPIC_ID);

    // Stale entry should be gone, only the new one remains
    expect(getAll()).toHaveLength(1);
    expect(getAll()[0].did).toBe("did:hcs:0.0.123:1");
  });
});
