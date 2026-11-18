import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TopicMessage } from "@agentbadge/hedera-core";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getTopicMessages: vi.fn(),
}));

import { getTopicMessages } from "@agentbadge/hedera-core";
import {
  a2aUpsert as upsert,
  a2aGetAll as getAll,
  getMessagesByTo,
  getConversation,
  a2aClear as clear,
  a2aRebuildFromHcs as rebuildFromHcs,
} from "@agentbadge/passport";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";

const mockedGetTopicMessages = vi.mocked(getTopicMessages);

const DID_A = "did:hcs:0.0.123:1";
const DID_B = "did:hcs:0.0.456:2";
const TOPIC_ID = "0.0.777";

function makeCachedMessage(
  overrides: Partial<CachedA2AMessage> = {},
): CachedA2AMessage {
  return {
    type: "a2a_message",
    from: DID_A,
    to: DID_B,
    body: "Hello",
    contentType: "text/plain",
    timestamp: 1700000000,
    txId: "0.0.2@1700000000.000000001",
    consensusTimestamp: "1700000000.000000001",
    ...overrides,
  };
}

function makeTopicMessage(
  timestamp: string,
  payload: Record<string, unknown>,
): TopicMessage {
  return {
    consensus_timestamp: timestamp,
    message: JSON.stringify(payload),
    sequence_number: 0,
    running_hash: "",
  };
}

describe("a2aCache", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
  });

  describe("upsert + getAll", () => {
    it("adds message to cache and retrieves it", () => {
      const msg = makeCachedMessage();
      upsert(msg);
      const all = getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(msg);
    });

    it("upsert with same consensusTimestamp overwrites", () => {
      upsert(makeCachedMessage({ body: "first" }));
      upsert(makeCachedMessage({ body: "second" }));
      const all = getAll();
      expect(all).toHaveLength(1);
      expect(all[0].body).toBe("second");
    });
  });

  describe("getMessagesByTo", () => {
    it("returns only messages where to === did", () => {
      upsert(makeCachedMessage({ to: DID_B, body: "msg1", consensusTimestamp: "1700000000.000000001" }));
      upsert(makeCachedMessage({ to: DID_A, from: DID_B, body: "msg2", consensusTimestamp: "1700000000.000000002" }));
      upsert(makeCachedMessage({ to: DID_B, body: "msg3", timestamp: 1700000001, consensusTimestamp: "1700000001.000000001" }));

      const result = getMessagesByTo(DID_B);
      expect(result).toHaveLength(2);
      expect(result[0].body).toBe("msg3"); // newest first (descending)
      expect(result[1].body).toBe("msg1");
    });

    it("returns empty array for DID with no messages", () => {
      upsert(makeCachedMessage({ to: DID_B }));
      const result = getMessagesByTo("did:hcs:0.0.999:9");
      expect(result).toHaveLength(0);
    });
  });

  describe("getConversation", () => {
    it("returns bidirectional messages sorted oldest first", () => {
      upsert(makeCachedMessage({ from: DID_A, to: DID_B, body: "A→B", timestamp: 100, consensusTimestamp: "100.000000001" }));
      upsert(makeCachedMessage({ from: DID_B, to: DID_A, body: "B→A", timestamp: 200, consensusTimestamp: "200.000000001" }));
      upsert(makeCachedMessage({ from: DID_A, to: DID_B, body: "A→B-2", timestamp: 300, consensusTimestamp: "300.000000001" }));

      const result = getConversation(DID_A, DID_B);
      expect(result).toHaveLength(3);
      expect(result[0].body).toBe("A→B"); // oldest first (ascending)
      expect(result[1].body).toBe("B→A");
      expect(result[2].body).toBe("A→B-2");
    });

    it("returns empty array for agents with no conversation", () => {
      const result = getConversation(DID_A, DID_B);
      expect(result).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("wipes the cache", () => {
      upsert(makeCachedMessage());
      expect(getAll()).toHaveLength(1);
      clear();
      expect(getAll()).toHaveLength(0);
    });
  });

  describe("rebuildFromHcs", () => {
    it("populates cache from HCS messages", async () => {
      const messages = [
        makeTopicMessage("1700000000.000000001", {
          type: "a2a_message",
          from: DID_A,
          to: DID_B,
          body: "Hello",
          contentType: "text/plain",
          timestamp: 1700000000,
        }),
        makeTopicMessage("1700000001.000000001", {
          type: "a2a_message",
          from: DID_B,
          to: DID_A,
          body: "Hi back",
          contentType: "text/plain",
          timestamp: 1700000001,
        }),
      ];
      mockedGetTopicMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);

      const all = getAll();
      expect(all).toHaveLength(2);
      expect(getMessagesByTo(DID_B)).toHaveLength(1);
      expect(getMessagesByTo(DID_A)).toHaveLength(1);
    });

    it("skips non-a2a_message types", async () => {
      const messages = [
        makeTopicMessage("1700000000.000000001", {
          type: "agent_register",
          did: DID_A,
        }),
        makeTopicMessage("1700000001.000000001", {
          type: "a2a_message",
          from: DID_A,
          to: DID_B,
          body: "Hello",
          contentType: "text/plain",
          timestamp: 1700000001,
        }),
      ];
      mockedGetTopicMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(1);
    });

    it("skips invalid JSON messages", async () => {
      const messages = [
        { consensus_timestamp: "1700000000.000000001", message: "not json", sequence_number: 0, running_hash: "" },
        makeTopicMessage("1700000001.000000001", {
          type: "a2a_message",
          from: DID_A,
          to: DID_B,
          body: "Hello",
          contentType: "text/plain",
          timestamp: 1700000001,
        }),
      ];
      mockedGetTopicMessages.mockResolvedValueOnce(messages as TopicMessage[]);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(1);
    });

    it("retries on failure with exponential backoff", async () => {
      mockedGetTopicMessages
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce([]);

      await rebuildFromHcs(TOPIC_ID, { maxAttempts: 3, baseDelayMs: 10 });
      expect(mockedGetTopicMessages).toHaveBeenCalledTimes(3);
    });

    it("throws after max attempts", async () => {
      mockedGetTopicMessages.mockRejectedValue(new Error("Persistent error"));

      await expect(
        rebuildFromHcs(TOPIC_ID, { maxAttempts: 2, baseDelayMs: 10 }),
      ).rejects.toThrow("Persistent error");
      expect(mockedGetTopicMessages).toHaveBeenCalledTimes(2);
    });

    it("incremental rebuild merges with existing cache", async () => {
      upsert(makeCachedMessage({ body: "existing", consensusTimestamp: "1699999999.000000001" }));

      const messages = [
        makeTopicMessage("1700000001.000000001", {
          type: "a2a_message",
          from: DID_A,
          to: DID_B,
          body: "new",
          contentType: "text/plain",
          timestamp: 1700000001,
        }),
      ];
      mockedGetTopicMessages.mockResolvedValueOnce(messages);

      await rebuildFromHcs(TOPIC_ID, { incremental: true });
      expect(getAll()).toHaveLength(2);
    });

    it("full rebuild clears cache first", async () => {
      upsert(makeCachedMessage({ body: "old", consensusTimestamp: "1699999999.000000001" }));

      mockedGetTopicMessages.mockResolvedValueOnce([
        makeTopicMessage("1700000001.000000001", {
          type: "a2a_message",
          from: DID_A,
          to: DID_B,
          body: "new",
          contentType: "text/plain",
          timestamp: 1700000001,
        }),
      ]);

      await rebuildFromHcs(TOPIC_ID);
      expect(getAll()).toHaveLength(1);
      expect(getAll()[0].body).toBe("new");
    });
  });

  describe("performance", () => {
    it("handles 1000+ messages with <100ms query time", () => {
      for (let i = 0; i < 1000; i++) {
        upsert(
          makeCachedMessage({
            timestamp: 1700000000 + i,
            consensusTimestamp: `170000000${i}.000000001`,
            body: `msg-${i}`,
          }),
        );
      }

      const start = performance.now();
      const result = getConversation(DID_A, DID_B);
      const elapsed = performance.now() - start;

      expect(result).toHaveLength(1000);
      expect(elapsed).toBeLessThan(100);
    });
  });
});
