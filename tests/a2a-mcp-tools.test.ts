import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  submitA2AMessage: vi.fn(),
  getNftInfo: vi.fn(),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  a2aUpsert: vi.fn(),
  getMessagesByTo: vi.fn(),
  getConversation: vi.fn(),
}));

import { submitA2AMessage, getNftInfo } from "@agentbadge/hedera-core";
import { a2aUpsert as upsert, getMessagesByTo, getConversation } from "@agentbadge/passport";
import {
  sendMessageHandler,
  getInboxHandler,
  getConversationHandler,
  registerA2ATools,
} from "@agentbadge/mcp";

const mockedSubmit = vi.mocked(submitA2AMessage);
const mockedGetNftInfo = vi.mocked(getNftInfo);
const mockedUpsert = vi.mocked(upsert);
const mockedGetMessagesByTo = vi.mocked(getMessagesByTo);
const mockedGetConversation = vi.mocked(getConversation);

const SENDER_DID = "did:hcs:0.0.123:1";
const RECIPIENT_DID = "did:hcs:0.0.123:2";

const validNft = {
  token_id: "0.0.123",
  serial_number: 1,
  account_id: "0.0.456",
  metadata: "ipfs://abc",
  deleted: false,
  created_timestamp: "2026-01-01T00:00:00Z",
};

describe("A2A MCP Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.A2A_TOPIC_ID = "0.0.999";
  });

  afterEach(() => {
    delete process.env.A2A_TOPIC_ID;
  });

  describe("send_message", () => {
    it("returns txId and timestamp on valid input", async () => {
      mockedGetNftInfo
        .mockResolvedValueOnce(validNft)
        .mockResolvedValueOnce({ ...validNft, serial_number: 2 });
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@1234567890.000000001", consensusTimestamp: null });

      const result = await sendMessageHandler({
        from: SENDER_DID,
        to: RECIPIENT_DID,
        body: "Hello from agent 1",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.txId).toBe("0.0.111@1234567890.000000001");
      expect(parsed.timestamp).toBeTypeOf("number");
      expect(mockedSubmit).toHaveBeenCalledOnce();
      expect(mockedUpsert).toHaveBeenCalledOnce();
    });

    it("returns MCP error when sender passport not found", async () => {
      mockedGetNftInfo.mockResolvedValueOnce(null);

      const result = await sendMessageHandler({
        from: SENDER_DID,
        to: RECIPIENT_DID,
        body: "Hello",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Sender passport not found");
      expect(mockedSubmit).not.toHaveBeenCalled();
    });

    it("returns MCP error when recipient passport is revoked", async () => {
      mockedGetNftInfo
        .mockResolvedValueOnce(validNft)
        .mockResolvedValueOnce({ ...validNft, serial_number: 2, deleted: true });

      const result = await sendMessageHandler({
        from: SENDER_DID,
        to: RECIPIENT_DID,
        body: "Hello",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Recipient passport revoked");
      expect(mockedSubmit).not.toHaveBeenCalled();
    });

    it("returns validation error when body is missing", async () => {
      const result = await sendMessageHandler({
        from: SENDER_DID,
        to: RECIPIENT_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockedSubmit).not.toHaveBeenCalled();
    });

    it("returns MCP error when HCS submission fails", async () => {
      mockedGetNftInfo
        .mockResolvedValueOnce(validNft)
        .mockResolvedValueOnce({ ...validNft, serial_number: 2 });
      mockedSubmit.mockRejectedValue(new Error("HCS network error"));

      const result = await sendMessageHandler({
        from: SENDER_DID,
        to: RECIPIENT_DID,
        body: "Hello",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("HCS network error");
    });

    it("uses default contentType when not provided", async () => {
      mockedGetNftInfo
        .mockResolvedValueOnce(validNft)
        .mockResolvedValueOnce({ ...validNft, serial_number: 2 });
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@1234567890.000000001", consensusTimestamp: null });

      await sendMessageHandler({
        from: SENDER_DID,
        to: RECIPIENT_DID,
        body: "Hello",
      });

      const submittedMsg = mockedSubmit.mock.calls[0][0];
      expect(submittedMsg.contentType).toBe("text/plain");
    });
  });

  describe("get_inbox", () => {
    it("returns messages for valid DID", async () => {
      const mockMessages = [
        { type: "a2a_message", from: RECIPIENT_DID, to: SENDER_DID, body: "Hi", contentType: "text/plain", timestamp: 100, txId: "tx1", consensusTimestamp: "100" },
      ];
      mockedGetMessagesByTo.mockReturnValue(mockMessages as any);

      const result = await getInboxHandler({ did: SENDER_DID });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.count).toBe(1);
      expect(parsed.total).toBe(1);
      expect(mockedGetMessagesByTo).toHaveBeenCalledWith(SENDER_DID);
    });

    it("applies pagination (limit + offset)", async () => {
      const allMsgs = Array.from({ length: 10 }, (_, i) => ({
        type: "a2a_message",
        from: RECIPIENT_DID,
        to: SENDER_DID,
        body: `msg-${i}`,
        contentType: "text/plain",
        timestamp: 100 + i,
        txId: `tx-${i}`,
        consensusTimestamp: `${100 + i}`,
      }));
      mockedGetMessagesByTo.mockReturnValue(allMsgs as any);

      const result = await getInboxHandler({ did: SENDER_DID, limit: 3, offset: 2 });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.count).toBe(3);
      expect(parsed.total).toBe(10);
      expect(parsed.messages[0].body).toBe("msg-2");
    });

    it("returns validation error when did is missing", async () => {
      const result = await getInboxHandler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockedGetMessagesByTo).not.toHaveBeenCalled();
    });

    it("returns empty array when no messages", async () => {
      mockedGetMessagesByTo.mockReturnValue([]);

      const result = await getInboxHandler({ did: SENDER_DID });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toHaveLength(0);
      expect(parsed.count).toBe(0);
      expect(parsed.total).toBe(0);
    });
  });

  describe("get_conversation", () => {
    it("returns conversation between two DIDs", async () => {
      const mockConv = [
        { type: "a2a_message", from: SENDER_DID, to: RECIPIENT_DID, body: "Hello", contentType: "text/plain", timestamp: 100, txId: "tx1", consensusTimestamp: "100" },
        { type: "a2a_message", from: RECIPIENT_DID, to: SENDER_DID, body: "Hi back", contentType: "text/plain", timestamp: 200, txId: "tx2", consensusTimestamp: "200" },
      ];
      mockedGetConversation.mockReturnValue(mockConv as any);

      const result = await getConversationHandler({
        didA: SENDER_DID,
        didB: RECIPIENT_DID,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.didA).toBe(SENDER_DID);
      expect(parsed.didB).toBe(RECIPIENT_DID);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.count).toBe(2);
      expect(parsed.total).toBe(2);
      expect(parsed.messages[0].direction).toBe("A→B");
      expect(parsed.messages[1].direction).toBe("B→A");
      expect(mockedGetConversation).toHaveBeenCalledWith(SENDER_DID, RECIPIENT_DID);
    });

    it("applies pagination to conversation", async () => {
      const allMsgs = Array.from({ length: 20 }, (_, i) => ({
        type: "a2a_message",
        from: i % 2 === 0 ? SENDER_DID : RECIPIENT_DID,
        to: i % 2 === 0 ? RECIPIENT_DID : SENDER_DID,
        body: `msg-${i}`,
        contentType: "text/plain",
        timestamp: 100 + i,
        txId: `tx-${i}`,
        consensusTimestamp: `${100 + i}`,
      }));
      mockedGetConversation.mockReturnValue(allMsgs as any);

      const result = await getConversationHandler({
        didA: SENDER_DID,
        didB: RECIPIENT_DID,
        limit: 5,
        offset: 10,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toHaveLength(5);
      expect(parsed.count).toBe(5);
      expect(parsed.total).toBe(20);
      expect(parsed.limit).toBe(5);
      expect(parsed.offset).toBe(10);
    });

    it("returns validation error when didA is missing", async () => {
      const result = await getConversationHandler({ didB: RECIPIENT_DID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockedGetConversation).not.toHaveBeenCalled();
    });

    it("returns error when didA equals didB", async () => {
      const result = await getConversationHandler({
        didA: SENDER_DID,
        didB: SENDER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("must be different");
      expect(mockedGetConversation).not.toHaveBeenCalled();
    });

    it("returns empty conversation when no messages exist", async () => {
      mockedGetConversation.mockReturnValue([]);

      const result = await getConversationHandler({
        didA: SENDER_DID,
        didB: RECIPIENT_DID,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toHaveLength(0);
      expect(parsed.count).toBe(0);
      expect(parsed.total).toBe(0);
    });
  });

  describe("registerA2ATools", () => {
    it("registers all 3 tools without throwing", () => {
      expect(() => registerA2ATools()).not.toThrow();
    });
  });
});
