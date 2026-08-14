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

    it("context page has Engineering Services section (SLICE-59-5)", async () => {
      const res = await app.request("/agent-guide/context");
      const text = await res.text();
      expect(text).toContain("Engineering Services");
      expect(text).toContain("/agent-guide/team/capabilities");
      expect(text).toContain("/agent-guide/team/services");
    });

    it("GET /agent-guide/learn → 200 + text/markdown with numbered steps", async () => {
      const res = await app.request("/agent-guide/learn");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text.length).toBeGreaterThan(200);
      expect(text).toMatch(/\d+\./);
    });

    it("learn page has Need Help section (SLICE-59-6)", async () => {
      const res = await app.request("/agent-guide/learn");
      const text = await res.text();
      expect(text).toContain("Need Help");
      expect(text).toContain("/agent-guide/team/services");
      expect(text).toContain("/agent-guide/team/capabilities");
      expect(text).toContain("/agent-guide/team/contact");
      expect(text).toContain("/api/work-requests");
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

  describe("Agent Guide JSON manifest (SLICE-59-7)", () => {
    it("GET /agent-guide.json → 200 + application/json", async () => {
      const res = await app.request("/agent-guide.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const json = await res.json();
      expect(json.schema).toBeDefined();
    });

    it("manifest includes team endpoints in endpoints object", async () => {
      const res = await app.request("/agent-guide.json");
      const json = await res.json();
      expect(json.endpoints.team_capabilities).toBe("/agent-guide/team/capabilities");
      expect(json.endpoints.team_services).toBe("/agent-guide/team/services");
      expect(json.endpoints.team_contact).toBe("/agent-guide/team/contact");
      expect(json.endpoints.work_requests).toBe("/api/work-requests");
    });

    it("manifest includes engineering_capabilities array with 5 entries", async () => {
      const res = await app.request("/agent-guide.json");
      const json = await res.json();
      expect(Array.isArray(json.engineering_capabilities)).toBe(true);
      expect(json.engineering_capabilities).toHaveLength(5);
      expect(json.engineering_capabilities).toContain("ai-agent-architecture");
      expect(json.engineering_capabilities).toContain("mcp-development");
      expect(json.engineering_capabilities).toContain("geo-optimization");
      expect(json.engineering_capabilities).toContain("blockchain-development");
      expect(json.engineering_capabilities).toContain("backend-development");
    });

    it("manifest includes team_endpoints array with 4 entries", async () => {
      const res = await app.request("/agent-guide.json");
      const json = await res.json();
      expect(Array.isArray(json.team_endpoints)).toBe(true);
      expect(json.team_endpoints).toHaveLength(4);
    });

    it("manifest concepts array includes ruleset", async () => {
      const res = await app.request("/agent-guide.json");
      const json = await res.json();
      expect(json.concepts).toContain("ruleset");
    });

    it("GET /.well-known/agent-guide.json returns same manifest", async () => {
      const res = await app.request("/.well-known/agent-guide.json");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.endpoints.team_services).toBe("/agent-guide/team/services");
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

    it("GET /agent-guide/concepts/ruleset → 200 (SLICE-59-3)", async () => {
      const res = await app.request("/agent-guide/concepts/ruleset");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Open Ruleset");
      expect(text).toContain("/agent-guide/concepts/agent-readiness");
      expect(text).toContain("/agent-guide/concepts/scoring");
    });
  });

  describe("Concept capabilities block (SLICE-59-2)", () => {
    it("concept agent-readiness shows Relevant Engineering Capabilities", async () => {
      const res = await app.request("/agent-guide/concepts/agent-readiness");
      const text = await res.text();
      expect(text).toContain("Relevant Engineering Capabilities");
    });

    it("concept agent-readiness links to team/capabilities", async () => {
      const res = await app.request("/agent-guide/concepts/agent-readiness");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/capabilities");
    });

    it("concept scoring shows Relevant Engineering Capabilities", async () => {
      const res = await app.request("/agent-guide/concepts/scoring");
      const text = await res.text();
      expect(text).toContain("Relevant Engineering Capabilities");
    });

    it("concept badge shows Relevant Engineering Capabilities", async () => {
      const res = await app.request("/agent-guide/concepts/badge");
      const text = await res.text();
      expect(text).toContain("Relevant Engineering Capabilities");
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

    it("capability scanner links to team services and contact (SLICE-59-4)", async () => {
      const res = await app.request("/agent-guide/capabilities/scanner");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/services");
      expect(text).toContain("/agent-guide/team/contact");
    });

    it("capability cli links to team services and contact (SLICE-59-4)", async () => {
      const res = await app.request("/agent-guide/capabilities/cli");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/services");
      expect(text).toContain("/agent-guide/team/contact");
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

  describe("Article structured template (SLICE-42-6R)", () => {
    it("article contains ## Summary section", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Summary");
    });

    it("article contains ## Problem section", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Problem");
    });

    it("article contains ## AgentBadge Relevance section", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## AgentBadge Relevance");
    });

    it("article contains ## Key Concepts section with concept links", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Key Concepts");
      expect(text).toContain("/agent-guide/concepts/agent-readiness");
      expect(text).toContain("/agent-guide/concepts/scoring");
      expect(text).toContain("/agent-guide/concepts/badge");
    });

    it("article contains ## Capabilities section with capability links", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Capabilities");
      expect(text).toContain("/agent-guide/capabilities/scanner");
      expect(text).toContain("/agent-guide/capabilities/cli");
    });

    it("article contains ## CLI Commands section", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## CLI Commands");
    });

    it("article contains ## API Endpoints section", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## API Endpoints");
    });

    it("article contains ## Recommended Actions section", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Recommended Actions");
    });

    it("article contains ## Knowledge Map section with node references", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Knowledge Map");
      expect(text).toContain("agent-readiness");
      expect(text).toContain("scanner");
      expect(text).toContain("scoring");
    });

    it("article contains ## Full Article section with original content", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("## Full Article");
      expect(text).toContain("SEO for AI agents");
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
