import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  submitA2AMessage: vi.fn(),
  verifyA2ADid: vi.fn(),
  getNftInfo: vi.fn(),
  getTopicMessages: vi.fn(),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  a2aUpsert: vi.fn(),
  getMessagesByTo: vi.fn(() => []),
  getConversation: vi.fn(() => []),
  a2aClear: vi.fn(),
  a2aRebuildFromHcs: vi.fn(),
  a2aStartBackgroundRebuild: vi.fn(),
}));

import { Hono } from "hono";
import { a2aRoutes } from "../src/server/routes/a2a";
import { submitA2AMessage, verifyA2ADid } from "@agentbadge/hedera-core";
import { a2aUpsert as upsert, getMessagesByTo, getConversation } from "@agentbadge/passport";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";

const mockedSubmitA2AMessage = vi.mocked(submitA2AMessage);
const mockedVerifyA2ADid = vi.mocked(verifyA2ADid);
const mockedUpsert = vi.mocked(upsert);
const mockedGetMessagesByTo = vi.mocked(getMessagesByTo);
const mockedGetConversation = vi.mocked(getConversation);

const DID_A = "did:hcs:0.0.1234567:1";
const DID_B = "did:hcs:0.0.7654321:2";

function makeApp() {
  const app = new Hono();
  app.route("/", a2aRoutes);
  return app;
}

async function postSend(app: Hono, body: Record<string, unknown>) {
  const req = new Request("http://localhost/a2a/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

async function getInbox(app: Hono, did: string) {
  const req = new Request(`http://localhost/a2a/inbox?did=${encodeURIComponent(did)}`, {
    method: "GET",
  });
  return app.fetch(req);
}

async function getConversationReq(
  app: Hono,
  params: Record<string, string>,
) {
  const url = new URL("http://localhost/a2a/conversation");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return app.fetch(new Request(url.toString(), { method: "GET" }));
}

describe("POST /a2a/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerifyA2ADid.mockReset();
    mockedSubmitA2AMessage.mockReset();
    mockedVerifyA2ADid.mockResolvedValue(true);
    mockedSubmitA2AMessage.mockResolvedValue({ txId: "0.0.2@1700000000.000000001", consensusTimestamp: null });
  });

  it("returns txId and timestamp on valid message", async () => {
    const app = makeApp();
    const res = await postSend(app, {
      from: DID_A,
      to: DID_B,
      body: "Hello!",
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.txId).toBeDefined();
    expect(json.timestamp).toBeGreaterThan(0);
    expect(mockedSubmitA2AMessage).toHaveBeenCalledOnce();
    expect(mockedUpsert).toHaveBeenCalledOnce();
  });

  it("returns 400 on missing required fields", async () => {
    const app = makeApp();
    const res = await postSend(app, { from: DID_A, to: DID_B });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Missing required fields");
  });

  it("returns 400 on invalid DID format", async () => {
    const app = makeApp();
    const res = await postSend(app, {
      from: "invalid-did",
      to: DID_B,
      body: "Hello",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid DID format");
  });

  it("returns 400 on invalid JSON body", async () => {
    const app = makeApp();
    const req = new Request("http://localhost/a2a/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when sender passport not found", async () => {
    mockedVerifyA2ADid
      .mockResolvedValueOnce(false) // sender
      .mockResolvedValueOnce(true); // recipient

    const app = makeApp();
    const res = await postSend(app, {
      from: DID_A,
      to: DID_B,
      body: "Hello",
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Sender passport");
  });

  it("returns 403 when recipient passport not found", async () => {
    mockedVerifyA2ADid
      .mockResolvedValueOnce(true) // sender
      .mockResolvedValueOnce(false); // recipient

    const app = makeApp();
    const res = await postSend(app, {
      from: DID_A,
      to: DID_B,
      body: "Hello",
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Recipient passport");
  });

  it("returns 500 on HCS submission failure", async () => {
    mockedSubmitA2AMessage.mockRejectedValue(new Error("HCS down"));

    const app = makeApp();
    const res = await postSend(app, {
      from: DID_A,
      to: DID_B,
      body: "Hello",
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("HCS down");
  });

  it("returns 400 when body exceeds 4KB after JSON encoding", async () => {
    const app = makeApp();
    const bigBody = "x".repeat(5000);
    const res = await postSend(app, {
      from: DID_A,
      to: DID_B,
      body: bigBody,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("exceeds");
  });

  it("uses default contentType when not provided", async () => {
    const app = makeApp();
    await postSend(app, {
      from: DID_A,
      to: DID_B,
      body: "Hello",
    });
    const submittedMsg = mockedSubmitA2AMessage.mock.calls[0][0];
    expect(submittedMsg.contentType).toBe("text/plain");
  });
});

describe("GET /a2a/inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns messages for valid DID", async () => {
    const mockMsgs: CachedA2AMessage[] = [
      {
        type: "a2a_message",
        from: DID_A,
        to: DID_B,
        body: "Hello",
        contentType: "text/plain",
        timestamp: 1700000000,
        txId: "0.0.2@1700000000",
        consensusTimestamp: "1700000000.000000001",
      },
    ];
    mockedGetMessagesByTo.mockReturnValueOnce(mockMsgs);

    const app = makeApp();
    const res = await getInbox(app, DID_B);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toHaveLength(1);
    expect(json.count).toBe(1);
  });

  it("returns 400 on missing did parameter", async () => {
    const app = makeApp();
    const req = new Request("http://localhost/a2a/inbox", { method: "GET" });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid DID format", async () => {
    const app = makeApp();
    const res = await getInbox(app, "invalid-did");
    expect(res.status).toBe(400);
  });

  it("returns empty array for DID with no messages", async () => {
    mockedGetMessagesByTo.mockReturnValueOnce([]);
    const app = makeApp();
    const res = await getInbox(app, DID_B);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([]);
    expect(json.count).toBe(0);
  });
});

describe("GET /a2a/conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bidirectional messages with direction field", async () => {
    const mockMsgs: CachedA2AMessage[] = [
      {
        type: "a2a_message",
        from: DID_A,
        to: DID_B,
        body: "A to B",
        contentType: "text/plain",
        timestamp: 100,
        txId: "tx1",
        consensusTimestamp: "100.000000001",
      },
      {
        type: "a2a_message",
        from: DID_B,
        to: DID_A,
        body: "B to A",
        contentType: "text/plain",
        timestamp: 200,
        txId: "tx2",
        consensusTimestamp: "200.000000001",
      },
    ];
    mockedGetConversation.mockReturnValueOnce(mockMsgs);

    const app = makeApp();
    const res = await getConversationReq(app, { didA: DID_A, didB: DID_B });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toHaveLength(2);
    expect(json.messages[0].direction).toBe("A→B");
    expect(json.messages[1].direction).toBe("B→A");
    expect(json.total).toBe(2);
    expect(json.count).toBe(2);
  });

  it("applies pagination with limit and offset", async () => {
    const mockMsgs: CachedA2AMessage[] = Array.from({ length: 50 }, (_, i) => ({
      type: "a2a_message" as const,
      from: DID_A,
      to: DID_B,
      body: `msg-${i}`,
      contentType: "text/plain",
      timestamp: 100 + i,
      txId: `tx-${i}`,
      consensusTimestamp: `${100 + i}.000000001`,
    }));
    mockedGetConversation.mockReturnValueOnce(mockMsgs);

    const app = makeApp();
    const res = await getConversationReq(app, {
      didA: DID_A,
      didB: DID_B,
      limit: "10",
      offset: "5",
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toHaveLength(10);
    expect(json.total).toBe(50);
    expect(json.limit).toBe(10);
    expect(json.offset).toBe(5);
    expect(json.messages[0].body).toBe("msg-5");
  });

  it("caps limit at 100", async () => {
    mockedGetConversation.mockReturnValueOnce([]);
    const app = makeApp();
    const res = await getConversationReq(app, {
      didA: DID_A,
      didB: DID_B,
      limit: "200",
    });
    const json = await res.json();
    expect(json.limit).toBe(100);
  });

  it("defaults limit to 50 and offset to 0", async () => {
    mockedGetConversation.mockReturnValueOnce([]);
    const app = makeApp();
    const res = await getConversationReq(app, { didA: DID_A, didB: DID_B });
    const json = await res.json();
    expect(json.limit).toBe(50);
    expect(json.offset).toBe(0);
  });

  it("returns 400 on missing didA or didB", async () => {
    const app = makeApp();
    const res = await getConversationReq(app, { didA: DID_A });
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid DID format", async () => {
    const app = makeApp();
    const res = await getConversationReq(app, {
      didA: "invalid",
      didB: DID_B,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when didA === didB", async () => {
    const app = makeApp();
    const res = await getConversationReq(app, {
      didA: DID_A,
      didB: DID_A,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("must be different");
  });

  it("returns empty array for conversation with no messages", async () => {
    mockedGetConversation.mockReturnValueOnce([]);
    const app = makeApp();
    const res = await getConversationReq(app, { didA: DID_A, didB: DID_B });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([]);
    expect(json.count).toBe(0);
    expect(json.total).toBe(0);
  });

  it("returns empty array when offset exceeds total", async () => {
    const mockMsgs: CachedA2AMessage[] = [
      {
        type: "a2a_message",
        from: DID_A,
        to: DID_B,
        body: "msg",
        contentType: "text/plain",
        timestamp: 100,
        txId: "tx1",
        consensusTimestamp: "100.000000001",
      },
    ];
    mockedGetConversation.mockReturnValueOnce(mockMsgs);

    const app = makeApp();
    const res = await getConversationReq(app, {
      didA: DID_A,
      didB: DID_B,
      offset: "100",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([]);
    expect(json.total).toBe(1);
  });
});
