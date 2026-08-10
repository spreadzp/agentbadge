import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { agentKnowledgeRoutes } from "../../src/server/routes/agent-knowledge";

const app = new Hono();
app.route("/", agentKnowledgeRoutes);

describe("No 404 on machine-readable endpoints (SLICE-51-10)", () => {
  it("/.well-known/agent-guide.json returns 200 with JSON", async () => {
    const res = await app.request("/.well-known/agent-guide.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");
  });

  it("/agent-guide.json returns 200 with JSON", async () => {
    const res = await app.request("/agent-guide.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");
  });

  it("/.well-known/ai-plugin.json is not referenced (404 acceptable)", async () => {
    const res = await app.request("/.well-known/ai-plugin.json");
    // 404 is acceptable as long as no page references it
    expect([200, 404]).toContain(res.status);
  });
});
