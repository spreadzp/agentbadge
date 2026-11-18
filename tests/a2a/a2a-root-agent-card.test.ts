import { describe, it, expect, vi, beforeAll } from "vitest";

// Same mocks as a2a-spec-mount.test.ts — module imports pull these in.
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
import { a2aSpecRoutes } from "../../src/server/routes/a2a/a2a-spec";
import { discoveryManifestRoutes } from "../../src/server/routes/discovery/discovery";

/**
 * SLICE-234-28: GET /a2a → canonical Agent Card.
 * Prod 404 signal: GET /a2a ×185/7d (top 404). The card must be
 * byte-identical to /.well-known/agent-card.json — both are served
 * from the shared MANIFEST_REGISTRY cache, so this test is a
 * drift-guard: if the card pipeline ever forks, both answers move
 * together or this fails.
 */
function makeApp() {
  const app = new Hono();
  app.route("/a2a", a2aSpecRoutes);
  app.route("/", discoveryManifestRoutes);
  return app;
}

beforeAll(() => {
  process.env.A2A_ANON_LIMIT = "100";
});

describe("SLICE-234-28: GET /a2a canonical agent card", () => {
  it("GET /a2a → 200 application/a2a+json", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/a2a"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/a2a+json");
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    const body = (await res.json()) as { name?: string };
    expect(body.name).toBe("AgentBadge");
  });

  it("GET /a2a body is byte-identical to /.well-known/agent-card.json", async () => {
    const app = makeApp();
    const [a2a, wk] = await Promise.all([
      app.fetch(new Request("http://localhost/a2a")),
      app.fetch(
        new Request("http://localhost/.well-known/agent-card.json"),
      ),
    ]);
    expect(a2a.status).toBe(200);
    expect(wk.status).toBe(200);
    expect(await a2a.text()).toBe(await wk.text());
  });

  it("POST /a2a still reaches the JSON-RPC endpoint (no route shadowing)", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/a2a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    // JSON-RPC error or result — anything but a 404/405 from routing.
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(405);
  });
});
