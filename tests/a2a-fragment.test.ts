import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftsForToken: vi.fn(),
  getNftInfo: vi.fn(),
  getNftsForAccount: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
  mintPassportNFT: vi.fn(),
  transferNFTToAgent: vi.fn(),
  wipeNFT: vi.fn(),
  updateNftMetadata: vi.fn(),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  getMessagesByTo: vi.fn(),
  getConversation: vi.fn(),
  a2aUpsert: vi.fn(),
  a2aGetAll: vi.fn(),
  a2aClear: vi.fn(),
}));

import { getMessagesByTo } from "@agentbadge/passport";
import { A2AInboxFragment } from "../src/views/a2a-fragment";
import { uiRoutes } from "../src/server/routes/ui";

const mockedGetMessagesByTo = vi.mocked(getMessagesByTo);

const USER_DID = "did:hcs:0.0.123:5";
const SENDER_DID = "did:hcs:0.0.456:10";

function makeMsg(overrides: Partial<CachedA2AMessage> = {}): CachedA2AMessage {
  return {
    type: "a2a_message",
    from: SENDER_DID,
    to: USER_DID,
    body: "Hello from agent A",
    contentType: "text/plain",
    timestamp: Math.floor(Date.now() / 1000) - 120,
    txId: "0.0.999@1700000000.000000001",
    consensusTimestamp: "1700000000.000000001",
    ...overrides,
  };
}

describe("A2AInboxFragment", () => {
  it("renders 'No messages' placeholder when empty", () => {
    const html = A2AInboxFragment({ messages: [], userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain("No messages");
  });

  it("renders message with from DID in short format", () => {
    const msg = makeMsg();
    const html = A2AInboxFragment({ messages: [msg], userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain("…");
    expect(str).toContain(SENDER_DID.slice(-8));
  });

  it("includes full DID in tooltip", () => {
    const msg = makeMsg();
    const html = A2AInboxFragment({ messages: [msg], userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain(`title="${SENDER_DID}"`);
  });

  it("truncates body to 50 chars with ellipsis", () => {
    const longBody = "A".repeat(80);
    const msg = makeMsg({ body: longBody });
    const html = A2AInboxFragment({ messages: [msg], userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain("…");
    expect(str).not.toContain(longBody);
  });

  it("renders relative time for timestamp", () => {
    const msg = makeMsg({ timestamp: Math.floor(Date.now() / 1000) - 120 });
    const html = A2AInboxFragment({ messages: [msg], userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain("minute");
  });

  it("includes View link with URL-encoded DIDs", () => {
    const msg = makeMsg();
    const html = A2AInboxFragment({ messages: [msg], userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain("/ui/conversation");
    expect(str).toContain(encodeURIComponent(USER_DID));
    expect(str).toContain(encodeURIComponent(SENDER_DID));
  });

  it("shows pagination 'Show more' button when >4 messages", () => {
    const msgs = Array.from({ length: 6 }, (_, i) => makeMsg({ consensusTimestamp: `170000000${i}` }));
    const html = A2AInboxFragment({ messages: msgs, userDid: USER_DID });
    const str = html.toString();
    expect(str).toContain("Show more");
    expect(str).toContain("data-paginated");
  });

  it("hides extra messages with data-paginated attribute", () => {
    const msgs = Array.from({ length: 6 }, (_, i) => makeMsg({ consensusTimestamp: `170000000${i}` }));
    const html = A2AInboxFragment({ messages: msgs, userDid: USER_DID });
    const str = html.toString();
    const paginatedCount = (str.match(/data-paginated="true"/g) || []).length;
    expect(paginatedCount).toBe(2);
  });

  it("does not show 'Show more' when <=4 messages", () => {
    const msgs = Array.from({ length: 4 }, (_, i) => makeMsg({ consensusTimestamp: `170000000${i}` }));
    const html = A2AInboxFragment({ messages: msgs, userDid: USER_DID });
    const str = html.toString();
    expect(str).not.toContain("Show more");
  });
});

describe("GET /ui/a2a/inbox", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 with inbox fragment when messages exist", async () => {
    mockedGetMessagesByTo.mockReturnValue([makeMsg()]);
    const res = await app.request(`/ui/a2a/inbox?did=${encodeURIComponent(USER_DID)}`, {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Hello from agent A");
  });

  it("returns 'No messages' when inbox is empty", async () => {
    mockedGetMessagesByTo.mockReturnValue([]);
    const res = await app.request(`/ui/a2a/inbox?did=${encodeURIComponent(USER_DID)}`, {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("No messages");
  });

  it("returns prompt for DID when did param missing", async () => {
    const res = await app.request("/ui/a2a/inbox", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("No DID provided");
  });

  it("wraps in Layout when accessed directly (non-HTMX)", async () => {
    mockedGetMessagesByTo.mockReturnValue([makeMsg()]);
    const res = await app.request(`/ui/a2a/inbox?did=${encodeURIComponent(USER_DID)}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<html");
  });
});
