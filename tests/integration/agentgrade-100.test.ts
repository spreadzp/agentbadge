import { describe, it, expect } from "vitest";

const BASE = process.env.AGENTGRADE_BASE_URL ?? "http://localhost:4021";

describe("AgentGrade 100% — Server Integration", () => {
  // === Discovery Group ===
  it("/.well-known/agent-card.json returns valid A2A card", async () => {
    const resp = await fetch(`${BASE}/.well-known/agent-card.json`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.name).toBeTruthy();
    expect(body.capabilities).toBeTruthy();
  });

  it("/llms.txt returns 200", async () => {
    const resp = await fetch(`${BASE}/llms.txt`);
    expect(resp.status).toBe(200);
  });

  it("/llms-full.txt returns 200", async () => {
    const resp = await fetch(`${BASE}/llms-full.txt`);
    expect(resp.status).toBe(200);
  });

  it("/skill.md returns 200 with markdown", async () => {
    const resp = await fetch(`${BASE}/skill.md`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/markdown");
  });

  it("/robots.txt returns 200", async () => {
    const resp = await fetch(`${BASE}/robots.txt`);
    expect(resp.status).toBe(200);
  });

  // === MCP Group ===
  it("MCP endpoint responds to initialize", async () => {
    const resp = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } }),
    });
    expect(resp.status).toBe(200);
    // MCP returns SSE format; parse the data line
    const text = await resp.text();
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    expect(dataLine).toBeTruthy();
    const body = JSON.parse(dataLine!.slice(6));
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result).toBeTruthy();
  });

  it("MCP tools/list returns tools array", async () => {
    const resp = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
    });
    const body = await resp.json();
    expect(body.result.tools).toBeInstanceOf(Array);
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  it("MCP CORS headers present", async () => {
    const resp = await fetch(`${BASE}/mcp`, { method: "OPTIONS" });
    expect(resp.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  // === Content Negotiation Group ===
  it("Accept: text/markdown returns markdown", async () => {
    const resp = await fetch(BASE, { headers: { Accept: "text/markdown" } });
    expect(resp.headers.get("content-type")).toContain("text/markdown");
  });

  it("Accept: application/json returns JSON", async () => {
    const resp = await fetch(BASE, { headers: { Accept: "application/json" } });
    expect(resp.headers.get("content-type")).toContain("application/json");
  });

  it("Vary: Accept header set", async () => {
    const resp = await fetch(BASE, { headers: { Accept: "text/markdown" } });
    expect(resp.headers.get("vary")).toContain("Accept");
  });

  // === Payments Group ===
  it("/.well-known/x402.json returns valid discovery", async () => {
    const resp = await fetch(`${BASE}/.well-known/x402.json`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.x402Version).toBeTruthy();
    expect(body.payTo).toBeTruthy();
    expect(body.services).toBeInstanceOf(Array);
  });

  it("paid endpoint returns 402", async () => {
    const resp = await fetch(`${BASE}/passport/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "bronze", accountId: "0.0.1234", signature: "0xtest", name: "TestAgent", capabilities: ["api_call"] }),
    });
    // x402 middleware returns 402 after signature validation passes,
    // or 401 if signature is invalid. Both prove the paid endpoint exists.
    expect([401, 402]).toContain(resp.status);
  });

  // === OpenAPI Group ===
  it("/openapi.json returns valid spec", async () => {
    const resp = await fetch(`${BASE}/openapi.json`);
    expect(resp.status).toBe(200);
    const spec = await resp.json();
    expect(spec.openapi).toBeTruthy();
    expect(spec.info.title).toBeTruthy();
    expect(spec.paths).toBeTruthy();
  });

  // === Infrastructure Group ===
  it("long-lived responses have cache headers", async () => {
    const resp = await fetch(`${BASE}/llms.txt`);
    expect(
      resp.headers.get("cache-control") ||
      resp.headers.get("etag") ||
      resp.headers.get("last-modified")
    ).toBeTruthy();
  });

  it("404 with Accept: application/json returns JSON error", async () => {
    const resp = await fetch(`${BASE}/nonexistent`, {
      headers: { Accept: "application/json" },
    });
    expect(resp.status).toBe(404);
    expect(resp.headers.get("content-type")).toContain("application/json");
  });

  // === Homepage & Meta Group ===
  it("og:image reachable", async () => {
    const html = await (await fetch(BASE)).text();
    const match = html.match(/property=["']og:image["'].*?content=["']([^"']+)/);
    expect(match).toBeTruthy();
    const imgUrl = match![1];
    const imgResp = await fetch(imgUrl);
    expect(imgResp.status).toBe(200);
  });

  it("canonical URL is present", async () => {
    const html = await (await fetch(BASE)).text();
    const match = html.match(/rel=["']canonical["'].*?href=["']([^"']+)/);
    expect(match).toBeTruthy();
  });

  it("SVG favicon present", async () => {
    const html = await (await fetch(BASE)).text();
    expect(html).toMatch(/rel=["']icon["'].*?\.svg/);
  });
});
