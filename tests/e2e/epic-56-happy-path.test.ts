import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";

setupMockEnv();
const app = makeTestApp();

/**
 * SLICE-56-13: E2E Happy Path
 *
 * Agent discovers → matches → creates request → human responds
 *
 * This test validates the full EPIC-56 flow:
 * 1. Agent discovers agency via /agency.json
 * 2. Agent reads llms.txt for endpoint discovery
 * 3. Agent reads /agent-guide/team/capabilities for matching
 * 4. Agent creates a work request via POST /api/work-requests
 * 5. Agent reads /services for human-readable catalog
 * 6. JSON-LD and agent surfaces are present
 */
describe("SLICE-56-13: E2E Happy Path — Agent discovers → matches → creates request", () => {
  describe("Step 1: Agent discovers agency via /agency.json", () => {
    it("GET /agency.json returns 200 with valid JSON", async () => {
      const res = await app.request("/agency.json");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.schema_version).toBeTruthy();
      expect(json.services).toBeDefined();
      expect(json.capabilities).toBeDefined();
      expect(json.people).toBeDefined();
    });

    it("agency.json includes registry_version", async () => {
      const res = await app.request("/agency.json");
      const json = await res.json();
      expect(json.registry_version).toBeTruthy();
    });

    it("agency.json includes evidence for VERIFIED capabilities", async () => {
      const res = await app.request("/agency.json");
      const json = await res.json();
      const verified = json.capabilities.filter(
        (c: any) => c.status === "VERIFIED",
      );
      expect(verified.length).toBeGreaterThan(0);
      expect(verified[0].evidence).toBeDefined();
      expect(verified[0].confidence).toBeGreaterThan(0);
    });
  });

  describe("Step 2: Agent reads llms.txt for endpoint discovery", () => {
    it("GET /llms.txt returns 200", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("AgentBadge");
    });

    it("llms.txt references agent-guide endpoints", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team");
    });

    it("llms.txt references work-requests API", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/api/work-requests");
    });
  });

  describe("Step 3: Agent reads capabilities for matching", () => {
    it("GET /agent-guide/team/capabilities returns 200", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      expect(res.status).toBe(200);
    });

    it("capabilities page lists capability names", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("AI Agent Architecture");
    });

    it("GET /agent-guide/team/services returns 200", async () => {
      const res = await app.request("/agent-guide/team/services");
      expect(res.status).toBe(200);
    });
  });

  describe("Step 4: Agent creates a work request", () => {
    it("POST /api/work-requests creates a request (202)", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            title: "MCP Server Development",
            summary: "Need an MCP server for our AI agent platform",
            requirements: ["TypeScript", "Hedera"],
          },
          preferred_contact: { channel: "email" },
        }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.request_id).toBeTruthy();
      expect(json.status_url).toContain("/api/work-requests/");
    });
  });

  describe("Step 5: Agent reads human-readable /services", () => {
    it("GET /services returns 200", async () => {
      const res = await app.request("/services");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Services");
    });
  });

  describe("Step 6: JSON-LD and agent surfaces", () => {
    it("GET /about contains Person JSON-LD with LinkedIn", async () => {
      const res = await app.request("/about");
      const html = await res.text();
      expect(html).toContain("application/ld+json");
      expect(html).toContain("Person");
      expect(html).toContain("linkedin.com");
    });

    it("GET /llms-full.txt returns 200", async () => {
      const res = await app.request("/llms-full.txt");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(100);
    });
  });
});
