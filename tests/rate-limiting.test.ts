import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/mcp", async (importOriginal) => ({
  ...await importOriginal(),
  handleHttpToolCall: vi.fn().mockResolvedValue({
    isError: false,
    content: [{ type: "text", text: "ok" }],
  }),
  listTools: vi.fn().mockReturnValue([{ name: "test_tool" }]),
}));

import { handleHttpToolCall } from "@agentbadge/mcp";
import { rateLimitMiddleware } from "../src/server/middleware/rate-limit";
import { mcpRoutes } from "../src/server/routes/mcp";

const mockedHandleToolCall = vi.mocked(handleHttpToolCall);

function makeApp(): Hono {
  const app = new Hono();
  app.use(rateLimitMiddleware({ windowMs: 60_000, max: 3 }));
  app.route("/", mcpRoutes);
  return app;
}

async function postTool(app: Hono, toolName = "test_tool", body = "{}"): Promise<Response> {
  return app.request(`/mcp/tools/${toolName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("rateLimitMiddleware — SLICE-7-3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests under the limit", async () => {
    const app = makeApp();

    const res = await postTool(app);
    expect(res.status).toBe(200);
  });

  it("returns 429 when limit exceeded", async () => {
    const app = makeApp();

    await postTool(app);
    await postTool(app);
    await postTool(app);

    const res = await postTool(app);
    expect(res.status).toBe(429);
  });

  it("includes X-RateLimit-Limit header", async () => {
    const app = makeApp();

    const res = await postTool(app);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("includes X-RateLimit-Remaining header", async () => {
    const app = makeApp();

    await postTool(app);
    const res = await postTool(app);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  it("includes Retry-After header when rate limited", async () => {
    const app = makeApp();

    await postTool(app);
    await postTool(app);
    await postTool(app);

    const res = await postTool(app);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });

  it("does not call tool handler when rate limited", async () => {
    const app = makeApp();

    await postTool(app);
    await postTool(app);
    await postTool(app);

    mockedHandleToolCall.mockClear();
    await postTool(app);
    expect(mockedHandleToolCall).not.toHaveBeenCalled();
  });

  it("rate limits per-IP (different IPs have separate limits)", async () => {
    const app = makeApp();

    // IP 1: 3 requests (at limit)
    await postTool(app);
    await postTool(app);
    await postTool(app);

    // IP 2: should still be allowed
    const res = await app.request("/mcp/tools/test_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.0.0.2" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("applies only to POST /mcp/tools/:name, not GET /mcp/tools", async () => {
    const app = makeApp();

    // Exhaust the rate limit with POSTs
    await postTool(app);
    await postTool(app);
    await postTool(app);
    await postTool(app); // 4th — rate limited

    // GET should still work
    const res = await app.request("/mcp/tools", { method: "GET" });
    expect(res.status).toBe(200);
  });
});
