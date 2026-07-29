import { describe, it, expect, beforeEach } from "vitest";
import { isValidA2AMessage, type A2AMessage, type CachedA2AMessage } from "@agentgate-hedera/hedera-core";

describe("isValidA2AMessage", () => {
  const valid: A2AMessage = {
    type: "a2a_message",
    from: "did:hcs:0.0.123:1",
    to: "did:hcs:0.0.456:2",
    body: "Hello Agent B",
    contentType: "text/plain",
    timestamp: 1700000000,
  };

  it("accepts a valid A2AMessage", () => {
    expect(isValidA2AMessage(valid)).toBe(true);
  });

  it("accepts a valid CachedA2AMessage (superset)", () => {
    const cached: CachedA2AMessage = {
      ...valid,
      txId: "0.0.2@1700000000.000000001",
      consensusTimestamp: "1700000000.000000001",
    };
    expect(isValidA2AMessage(cached)).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidA2AMessage(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidA2AMessage("string")).toBe(false);
    expect(isValidA2AMessage(42)).toBe(false);
    expect(isValidA2AMessage(undefined)).toBe(false);
  });

  it("rejects wrong type field", () => {
    expect(isValidA2AMessage({ ...valid, type: "agent_register" })).toBe(false);
  });

  it("rejects missing from field", () => {
    const { from: _from, ...rest } = valid;
    expect(isValidA2AMessage(rest)).toBe(false);
  });

  it("rejects missing to field", () => {
    const { to: _to, ...rest } = valid;
    expect(isValidA2AMessage(rest)).toBe(false);
  });

  it("rejects missing body field", () => {
    const { body: _body, ...rest } = valid;
    expect(isValidA2AMessage(rest)).toBe(false);
  });

  it("rejects missing contentType field", () => {
    const { contentType: _ct, ...rest } = valid;
    expect(isValidA2AMessage(rest)).toBe(false);
  });

  it("rejects missing timestamp field", () => {
    const { timestamp: _ts, ...rest } = valid;
    expect(isValidA2AMessage(rest)).toBe(false);
  });

  it("rejects wrong timestamp type (string instead of number)", () => {
    expect(isValidA2AMessage({ ...valid, timestamp: "1700000000" })).toBe(false);
  });

  it("rejects wrong from type (number instead of string)", () => {
    expect(isValidA2AMessage({ ...valid, from: 123 })).toBe(false);
  });
});

describe("submitA2AMessage (mock)", () => {
  beforeEach(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.A2A_TOPIC_ID = "0.0.777";
  });

  it("submits a message and returns a transaction ID", async () => {
    const { submitA2AMessage } = await import("@agentgate-hedera/hedera-core");
    const message: A2AMessage = {
      type: "a2a_message",
      from: "did:hcs:0.0.123:1",
      to: "did:hcs:0.0.456:2",
      body: "Hello from A to B",
      contentType: "text/plain",
      timestamp: Math.floor(Date.now() / 1000),
    };

    const txId = await submitA2AMessage(message);
    expect(typeof txId).toBe("string");
    expect(txId).toContain("@");
  });

  it("persists message to mock topic store for cache rebuild", async () => {
    const { submitA2AMessage } = await import("@agentgate-hedera/hedera-core");
    const { getTopicMessages } = await import("@agentgate-hedera/hedera-core");
    const message: A2AMessage = {
      type: "a2a_message",
      from: "did:hcs:0.0.123:1",
      to: "did:hcs:0.0.456:2",
      body: "Cache rebuild test",
      contentType: "text/plain",
      timestamp: Math.floor(Date.now() / 1000),
    };

    await submitA2AMessage(message);
    const msgs = await getTopicMessages("0.0.777");
    expect(msgs.length).toBeGreaterThan(0);
    const last = msgs[0];
    const parsed = JSON.parse(last.message);
    expect(parsed.type).toBe("a2a_message");
    expect(parsed.body).toBe("Cache rebuild test");
  });
});
