import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-2: Registry Loader + JSON/Markdown", () => {
  describe("GET /agent-guide/team/capabilities.json", () => {
    it("returns 200 + application/json", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("contains schema_version", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(json.schema_version).toBe("1.0");
    });

    it("contains categories array", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(Array.isArray(json.categories)).toBe(true);
      expect(json.categories.length).toBeGreaterThanOrEqual(3);
    });

    it("contains skills array", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(Array.isArray(json.skills)).toBe(true);
      expect(json.skills.length).toBeGreaterThanOrEqual(5);
    });

    it("contains capabilities array with evidence and confidence", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(Array.isArray(json.capabilities)).toBe(true);
      expect(json.capabilities.length).toBeGreaterThanOrEqual(4);

      const mcpCap = json.capabilities.find(
        (c: any) => c.id === "mcp-development",
      );
      expect(mcpCap).toBeDefined();
      expect(mcpCap.evidence).toBeDefined();
      expect(mcpCap.evidence.length).toBeGreaterThanOrEqual(1);
      expect(mcpCap.confidence).toBeGreaterThan(0);
      expect(mcpCap.status).toBe("VERIFIED");
    });

    it("contains services array with problem and deliverables", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(Array.isArray(json.services)).toBe(true);
      expect(json.services.length).toBeGreaterThanOrEqual(3);

      const svc = json.services[0];
      expect(svc.problem).toBeDefined();
      expect(svc.deliverables).toBeDefined();
      expect(svc.engagement).toBeDefined();
      expect(svc.contact).toBeDefined();
    });

    it("contains people array with capabilities", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(Array.isArray(json.people)).toBe(true);
      expect(json.people.length).toBeGreaterThanOrEqual(1);

      const paul = json.people.find((p: any) => p.id === "paul");
      expect(paul).toBeDefined();
      expect(paul.capabilities.length).toBeGreaterThanOrEqual(4);
      expect(paul.roles).toBeDefined();
      expect(paul.availability).toBeDefined();
    });

    it("contains warnings array (may be empty)", async () => {
      const res = await app.request("/agent-guide/team/capabilities.json");
      const json = await res.json();
      expect(Array.isArray(json.warnings)).toBe(true);
    });
  });

  describe("GET /agent-guide/team/capabilities (Markdown)", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains heading with Engineering Capabilities", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("Engineering Capabilities");
    });

    it("contains Paul in Who can help section", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("Paul");
    });

    it("contains capability names as headers", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("MCP Server Development");
      expect(text).toContain("Blockchain Development");
    });

    it("contains evidence section", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("Evidence");
      expect(text).toContain("AgentBadge");
    });

    it("contains confidence scores", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("Confidence");
    });

    it("contains Missing capability section", async () => {
      const res = await app.request("/agent-guide/team/capabilities");
      const text = await res.text();
      expect(text).toContain("Missing capability");
    });
  });
});
