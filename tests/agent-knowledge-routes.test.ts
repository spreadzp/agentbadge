/**
 * SLICE-42-4: Local Test Infrastructure
 *
 * Comprehensive tests for all Agent Knowledge Layer routes,
 * marketplace guide migration, and llms.txt content.
 *
 * Uses makeTestApp() from e2e/helpers.ts — same app setup as production.
 *
 * Routes tested:
 *   GET /agent-guide/                   → text/markdown (index)
 *   GET /agent-guide/context            → text/markdown
 *   GET /agent-guide/learn              → text/markdown
 *   GET /agent-guide/knowledge-map.json → application/json
 *   GET /agent-guide/concepts/:name     → text/markdown (200 or 404)
 *   GET /agent-guide/capabilities/:name → text/markdown (200 or 404)
 *   GET /agent-guide/articles/:slug     → text/markdown (200 or 404)
 *   GET /marketplace-guide              → text/markdown (migrated from /agent-guide)
 *   GET /llms.txt                       → text/markdown (contains agent-guide + marketplace-guide)
 */

import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("Agent Knowledge Layer Routes", () => {
  describe("Base guides", () => {
    it("GET /agent-guide/ (index) → 200 + text/markdown with links", async () => {
      const res = await app.request("/agent-guide/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("context");
      expect(text).toContain("learn");
      expect(text).toContain("knowledge-map");
    });

    it("GET /agent-guide/context → 200 + text/markdown with key terms", async () => {
      const res = await app.request("/agent-guide/context");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("Agent Readiness");
      expect(text).toContain("AgentBadge");
      expect(text).toContain("scanner");
    });

    it("GET /agent-guide/learn → 200 + text/markdown with numbered steps", async () => {
      const res = await app.request("/agent-guide/learn");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text.length).toBeGreaterThan(200);
      expect(text).toMatch(/\d+\./);
    });
  });

  describe("Knowledge map", () => {
    it("GET /agent-guide/knowledge-map.json → 200 + application/json", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const json = await res.json();
      expect(json.nodes).toBeDefined();
      expect(json.edges).toBeDefined();
      expect(Array.isArray(json.nodes)).toBe(true);
      expect(Array.isArray(json.edges)).toBe(true);
      expect(json.nodes.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("Concepts", () => {
    it("GET /agent-guide/concepts/agent-readiness → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/concepts/agent-readiness");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("Agent Readiness");
    });

    it("GET /agent-guide/concepts/scoring → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/concepts/scoring");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("scoring");
    });

    it("GET /agent-guide/concepts/badge → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/concepts/badge");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("badge");
    });

    it("GET /agent-guide/concepts/nonexistent → 404", async () => {
      const res = await app.request("/agent-guide/concepts/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("Capabilities", () => {
    it("GET /agent-guide/capabilities/scanner → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/capabilities/scanner");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("scanner");
    });

    it("GET /agent-guide/capabilities/cli → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/capabilities/cli");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("CLI");
    });

    it("GET /agent-guide/capabilities/nonexistent → 404", async () => {
      const res = await app.request("/agent-guide/capabilities/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("Articles", () => {
    it("GET /agent-guide/articles/what-is-agent-readiness → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("Agent Readiness");
      expect(text.length).toBeGreaterThan(500);
    });

    it("GET /agent-guide/articles/nonexistent → 404", async () => {
      const res = await app.request("/agent-guide/articles/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});

describe("Marketplace guide migration (SLICE-42-3)", () => {
  it("GET /marketplace-guide → 200 (old agent-guide content moved here)", async () => {
    const res = await app.request("/marketplace-guide");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("passport");
  });
});

describe("llms.txt integration (SLICE-42-3)", () => {
  it("GET /llms.txt → 200 + contains /agent-guide/context", async () => {
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/agent-guide/context");
  });

  it("GET /llms.txt → 200 + contains /marketplace-guide", async () => {
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/marketplace-guide");
  });
});
