import { describe, it, expect, vi, beforeAll } from "vitest";

// Mailbox deps mocked — alias test asserts routing, not HCS behavior.
vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...(await importOriginal()),
  submitA2AMessage: vi.fn(),
  verifyA2ADid: vi.fn(),
  getNftInfo: vi.fn(),
  getTopicMessages: vi.fn(),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...(await importOriginal()),
  a2aUpsert: vi.fn(),
  getMessagesByTo: vi.fn(() => []),
  getConversation: vi.fn(() => []),
  a2aClear: vi.fn(),
  a2aRebuildFromHcs: vi.fn(),
  a2aStartBackgroundRebuild: vi.fn(),
}));

import { Hono } from "hono";
import { a2aRoutes } from "../src/server/routes/a2a";
import { a2aSpecRoutes } from "../src/server/routes/a2a-spec";
import { getMessagesByTo } from "@agentbadge/passport";

const mockedGetMessagesByTo = vi.mocked(getMessagesByTo);

function makeApp() {
  const app = new Hono();
  app.route("/a2a", a2aSpecRoutes);
  app.route("/", a2aRoutes);
  return app;
}

beforeAll(() => {
  // Keep the shared spec app's windowed anon limit from 429ing the suite.
  process.env.A2A_ANON_LIMIT = "100";
});

describe("A2A v1.0 spec mount (SLICE-203-5)", () => {
  it("GET /a2a/challenge → nonce + timestamp", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/a2a/challenge"),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { nonce: string; timestamp: number };
    expect(j.nonce).toBeTruthy();
    expect(j.timestamp).toBeGreaterThan(0);
  });

  it("POST /a2a/message:send → task JSON w/ a2a content-type + version", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/a2a/message:send", {
        method: "POST",
        headers: { "content-type": "application/a2a+json" },
        body: JSON.stringify({
          tenant: "t1",
          message: {
            messageId: "m1",
            role: "user",
            parts: [{ kind: "text", text: "hello agent" }],
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("a2a-version")).toBe("1.0");
    const task = (await res.json()) as { id: string; status?: { state?: string } };
    expect(task.id).toBeTruthy();
    expect(task.status?.state).toBe("TASK_STATE_COMPLETED");
  });

  it("JSON-RPC POST /a2a (SendMessage) → result", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/a2a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "SendMessage",
          params: {
            tenant: "t1",
            message: {
              messageId: "m2",
              role: "user",
              parts: [{ kind: "text", text: "rpc hello" }],
            },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: number; result?: { id?: string } };
    expect(j.id).toBe(7);
    expect(j.result).toBeTruthy();
  });

  it("GET /a2a/tasks → caller-scoped list shape", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/a2a/tasks?tenant=t1"),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { tasks?: unknown[] };
    expect(j.tasks).toBeDefined();
  });

  it("mailbox alias: GET /a2a/hcs/inbox routes to the inbox handler", async () => {
    mockedGetMessagesByTo.mockClear();
    const res = await makeApp().fetch(
      new Request(
        "http://localhost/a2a/hcs/inbox?did=did:hcs:0.0.1234567:1",
      ),
    );
    // 200/4xx are both fine — what matters is the mailbox handler ran
    // (mock called) instead of a spec-route 404.
    expect(res.status).not.toBe(404);
    expect(mockedGetMessagesByTo).toHaveBeenCalled();
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
});
