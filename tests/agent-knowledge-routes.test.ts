/**
 * SLICE-42-1: Agent Knowledge Layer Routes — TDD Tests
 *
 * Tests for the Agent Knowledge Layer that serves Markdown content
 * to AI agents and humans.
 *
 * Routes tested:
 *   GET /agent-guide/context            → text/markdown
 *   GET /agent-guide/learn              → text/markdown
 *   GET /agent-guide/knowledge-map.json → application/json
 *   GET /agent-guide/concepts/:name     → text/markdown (200 or 404)
 *   GET /agent-guide/capabilities/:name → text/markdown (200 or 404)
 *   GET /agent-guide/articles/:slug     → text/markdown (200 or 404)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { agentKnowledgeRoutes } from "../src/server/routes/agent-knowledge";

function makeKnowledgeTestApp(): Hono {
  const app = new Hono();
  app.route("/", agentKnowledgeRoutes);
  return app;
}

const app = makeKnowledgeTestApp();

describe("Agent Knowledge Layer Routes", () => {
  describe("Base guides", () => {
    it("GET /agent-guide/context → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/context");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text).toContain("Agent Readiness");
    });

    it("GET /agent-guide/learn → 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/learn");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const text = await res.text();
      expect(text.length).toBeGreaterThan(100);
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
    });

    it("GET /agent-guide/concepts/nonexistent → 404", async () => {
      const res = await app.request("/agent-guide/concepts/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("Capabilities", () => {
    it("GET /agent-guide/capabilities/nonexistent → 404", async () => {
      const res = await app.request("/agent-guide/capabilities/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("Articles", () => {
    it("GET /agent-guide/articles/nonexistent → 404", async () => {
      const res = await app.request("/agent-guide/articles/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
