import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-7: Human pages — /team, /services, /work-with-us", () => {
  describe("GET /team (redirects to /about)", () => {
    it("returns 301 redirect to /about", async () => {
      const res = await app.request("/team");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toContain("/about");
    });
  });

  describe("GET /about (canonical team page)", () => {
    it("returns 200", async () => {
      const res = await app.request("/about");
      expect(res.status).toBe(200);
    });

    it("contains team or about heading", async () => {
      const res = await app.request("/about");
      const html = await res.text();
      expect(html).toContain("AgentBadge");
    });

    it("links to /services", async () => {
      const res = await app.request("/about");
      const html = await res.text();
      expect(html).toContain("/services");
    });
  });

  describe("GET /services", () => {
    it("returns 200", async () => {
      const res = await app.request("/services");
      expect(res.status).toBe(200);
    });

    it("contains services catalog heading", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("Services Catalog");
    });

    it("renders service names from registry", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("MCP Server Development");
    });

    it("renders problem descriptions", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("Problem");
    });

    it("renders deliverables", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("Deliverables");
    });

    it("renders engagement models", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("Engagement");
    });

    it("links to /work-with-us", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("/work-with-us");
    });
  });

  describe("GET /work-with-us", () => {
    it("returns 200", async () => {
      const res = await app.request("/work-with-us");
      expect(res.status).toBe(200);
    });

    it("contains engagement heading", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("Work With the AgentBadge Team");
    });

    it("lists engagement types", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("Contract");
      expect(html).toContain("Part-time");
      expect(html).toContain("Fixed-scope");
    });

    it("contains process section", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("Process");
    });

    it("contains availability section", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("Availability");
    });

    it("contains contact section", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("Contact");
    });

    it("links to /services", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("/services");
    });

    it("links to /agent-guide/team/capabilities", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("/agent-guide/team/capabilities");
    });
  });

  describe("Pages use Hono HTML (no React)", () => {
    it("about page has no React root div", async () => {
      const res = await app.request("/about");
      const html = await res.text();
      expect(html).not.toContain('id="root"');
    });

    it("services page has no React root div", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).not.toContain('id="root"');
    });

    it("work-with-us page has no React root div", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).not.toContain('id="root"');
    });
  });

  describe("Pages are responsive (mobile-friendly)", () => {
    it("about page has responsive grid classes", async () => {
      const res = await app.request("/about");
      const html = await res.text();
      expect(html).toContain("sm:grid-cols");
    });

    it("services page has responsive grid classes", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("sm:grid-cols-2");
    });

    it("work-with-us page has responsive grid classes", async () => {
      const res = await app.request("/work-with-us");
      const html = await res.text();
      expect(html).toContain("sm:grid-cols-3");
    });
  });

  describe("Pages render from registry data (no hardcoded capabilities)", () => {
    it("about page contains registry-derived content", async () => {
      const res = await app.request("/about");
      const html = await res.text();
      // About page should contain team/person info
      expect(html).toContain("Paul");
    });

    it("services page renders all registry services", async () => {
      const res = await app.request("/services");
      const html = await res.text();
      expect(html).toContain("MCP Server Development");
      expect(html).toContain("Blockchain Infrastructure");
      expect(html).toContain("AI Agent Consulting");
      expect(html).toContain("GEO Consulting");
    });
  });
});
