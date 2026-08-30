import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../../src/server/routes/well-known";

describe("GET /.well-known/webmcp.json", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("returns 200", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    expect(res.status).toBe(200);
  });

  it("returns Content-Type application/json", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns Cache-Control header", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    expect(res.headers.get("Cache-Control")).not.toBeNull();
  });

  it("returns valid JSON with tools array", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    const body = await res.json();
    expect(body).toHaveProperty("tools");
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("includes all 6 imperative tools", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    const body = await res.json();
    expect(body.tools.length).toBe(6);
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("agent-readiness-scan");
    expect(names).toContain("badge-generate");
    expect(names).toContain("passport-issue");
    expect(names).toContain("passport-verify");
    expect(names).toContain("get-compliance-score");
    expect(names).toContain("search-rules");
  });

  it("each tool has name, description, inputSchema", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    const body = await res.json();
    for (const tool of body.tools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(tool.inputSchema).toHaveProperty("properties");
      expect(tool.inputSchema).toHaveProperty("required");
    }
  });

  it("each tool has annotations with readOnlyHint and untrustedContentHint", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    const body = await res.json();
    for (const tool of body.tools) {
      expect(tool).toHaveProperty("annotations");
      expect(tool.annotations).toHaveProperty("readOnlyHint");
      expect(tool.annotations).toHaveProperty("untrustedContentHint");
    }
  });

  it("does not include execute functions in output", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    const body = await res.json();
    for (const tool of body.tools) {
      expect(tool).not.toHaveProperty("execute");
    }
  });
});
