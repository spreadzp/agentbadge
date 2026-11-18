/**
 * SLICE-234-34: agent-guide demand coverage.
 *
 * Prod evidence (http-traffic 2026-11-02..09): 502 hits/week on
 * /agent-guide/{concepts,capabilities,articles} 404s.
 *
 * Covers:
 *   - cross-namespace aliases (blog-slug → /blog/, capability → capabilities/)
 *   - 404-body suggestions pointer → /agent-guide + knowledge-map.json
 *   - 10 new generic concept pages → 200 markdown
 */

import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-234-34: cross-namespace aliases", () => {
  it("GET /agent-guide/articles/<blog-slug> → 301 /blog/<slug>", async () => {
    const res = await app.request("/agent-guide/articles/arc-c40-agent-interop");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/blog/arc-c40-agent-interop");
  });

  it("GET /agent-guide/concepts/x402 → 301 /agent-guide/capabilities/x402", async () => {
    const res = await app.request("/agent-guide/concepts/x402");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/agent-guide/capabilities/x402");
  });

  it("GET /agent-guide/concepts/usdc → 200 (new concept page, not alias)", async () => {
    const res = await app.request("/agent-guide/concepts/usdc");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("USDC");
  });
});

describe("SLICE-234-34: 404-pointer suggestions", () => {
  it.each([
    "/agent-guide/concepts/never-existed-xyz",
    "/agent-guide/capabilities/never-existed-xyz",
    "/agent-guide/articles/never-existed-xyz",
  ])("GET %s → 404 + suggestions → knowledge-map", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.suggestions).toContain("/agent-guide/knowledge-map.json");
    expect(body.suggestions).toContain("/agent-guide");
  });
});

describe("SLICE-234-34: new concept pages", () => {
  it.each([
    "eip-3009", "did", "ai-agents", "erc-8183", "micropayments",
    "api-discovery", "agent-wallet", "keyless", "machine-readable",
  ])("GET /agent-guide/concepts/%s → 200 markdown", async (name) => {
    const res = await app.request(`/agent-guide/concepts/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(200);
  });
});
