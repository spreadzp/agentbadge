/**
 * SLICE-141-8: GET /bstock-guide — markdown agent instructions
 * (free tier, 402→x402→ServicePass flow, rate limits, tool examples).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { bstockGuideRoutes } from "../src/server/routes/bstock-guide";

function makeApp() {
  const app = new Hono();
  app.route("/", bstockGuideRoutes);
  return app;
}

describe("GET /bstock-guide", () => {
  it("returns markdown by default", async () => {
    const res = await makeApp().request("/bstock-guide", {
      headers: { Accept: "text/markdown" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("# bStock Delta Tracker");
  });

  it("documents free tier: 1 req/min + tool names", async () => {
    const res = await makeApp().request("/bstock-guide", {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();
    expect(body).toContain("1 req/min");
    for (const tool of ["get_delta", "list_deltas", "get_quote"]) {
      expect(body).toContain(tool);
    }
  });

  it("documents the 402 → x402 → ServicePass payment flow", async () => {
    const res = await makeApp().request("/bstock-guide", {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();
    expect(body).toContain("402");
    expect(body).toContain("PAYMENT-REQUIRED");
    expect(body).toContain("PAYMENT-SIGNATURE");
    expect(body).toContain("$5");
    expect(body).toContain("30");
  });

  it("documents paid tier limits: 60 req/min, 20 SSE connections", async () => {
    const res = await makeApp().request("/bstock-guide", {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();
    expect(body).toContain("60 req/min");
    expect(body).toContain("20");
  });

  it("includes curl/MCP call examples", async () => {
    const res = await makeApp().request("/bstock-guide", {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();
    expect(body).toContain("/mcp/bstock");
    expect(body).toContain("Bearer");
    expect(body).toContain("tools/call");
  });

  it("returns HTML with HowTo JSON-LD for browsers", async () => {
    const res = await makeApp().request("/bstock-guide", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<html");
    expect(body).toContain('"@type":"HowTo"');
  });
});
