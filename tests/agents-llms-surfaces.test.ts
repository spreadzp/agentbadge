import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";
import { catalogRoutes } from "../src/server/routes/catalog";

describe("SLICE-56-6: agents.txt and llms.txt surfaces", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
    app.route("/", catalogRoutes);
  });

  // ─── AC-6.1: agents.txt lists agency profile, capabilities, contacts ───

  describe("GET /agents.txt — AC-6.1", () => {
    it("returns 200 with text/plain content", async () => {
      const res = await app.request("/agents.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
    });

    it("includes Agency Profile section", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("## Agency Profile");
      expect(text).toContain("AgentBadge");
    });

    it("lists team overview link", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team");
    });

    it("lists capabilities links", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("## Capabilities");
      expect(text).toContain("/agent-guide/team/capabilities");
      expect(text).toContain("/agent-guide/team/capabilities.json");
    });

    it("lists services link", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/services");
    });

    it("lists contacts section", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("## Contacts");
      expect(text).toContain("/contact");
    });

    it("lists work requests and demand in contacts", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("/api/work-requests");
      expect(text).toContain("/api/demand/request");
    });

    it("preserves existing access policy info", async () => {
      const res = await app.request("/agents.txt");
      const text = await res.text();
      expect(text).toContain("Rate limit");
      expect(text).toContain("/mcp");
      expect(text).toContain("/llms.txt");
    });
  });

  // ─── AC-6.2: llms.txt and llms-full.txt include all agent-facing endpoints ───

  describe("GET /llms.txt — AC-6.2", () => {
    it("returns 200 with text/markdown content type", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/markdown");
    });

    it("includes Engineering Capabilities section with team endpoints", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("## Engineering Capabilities");
      expect(text).toContain("/agent-guide/team");
      expect(text).toContain("/agent-guide/team/capabilities");
    });

    it("includes Demand & Work Requests section", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("## Demand & Work Requests");
    });

    it("lists /api/demand/request endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/api/demand/request");
    });

    it("lists /agent-guide/demand endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/demand");
    });

    it("lists /api/work-requests endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/api/work-requests");
    });

    it("links to llms-full.txt", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("llms-full.txt");
    });
  });

  describe("GET /llms-full.txt — AC-6.2", () => {
    it("returns 200 with text/plain content type", async () => {
      const res = await app.request("/llms-full.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
    });

    it("includes Engineering Capabilities section with team endpoints", async () => {
      const res = await app.request("/llms-full.txt");
      const text = await res.text();
      expect(text).toContain("## Engineering Capabilities");
      expect(text).toContain("/agent-guide/team");
    });

    it("includes Demand & Work Requests section", async () => {
      const res = await app.request("/llms-full.txt");
      const text = await res.text();
      expect(text).toContain("## Demand & Work Requests");
    });

    it("lists /api/demand/request endpoint", async () => {
      const res = await app.request("/llms-full.txt");
      const text = await res.text();
      expect(text).toContain("/api/demand/request");
    });

    it("lists /agent-guide/demand endpoint", async () => {
      const res = await app.request("/llms-full.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/demand");
    });

    it("lists /api/work-requests endpoint", async () => {
      const res = await app.request("/llms-full.txt");
      const text = await res.text();
      expect(text).toContain("/api/work-requests");
    });
  });
});
