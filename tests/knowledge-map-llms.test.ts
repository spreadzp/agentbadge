import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-4: Knowledge-map extension + llms.txt", () => {
  describe("GET /agent-guide/knowledge-map.json", () => {
    it("returns 200 + application/json", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("includes team node", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const teamNode = data.nodes.find((n: any) => n.id === "team");
      expect(teamNode).toBeDefined();
      expect(teamNode.label).toContain("Team");
    });

    it("includes capabilities node", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const capNode = data.nodes.find((n: any) => n.id === "capabilities");
      expect(capNode).toBeDefined();
    });

    it("includes services node", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const svcNode = data.nodes.find((n: any) => n.id === "services");
      expect(svcNode).toBeDefined();
    });

    it("includes people node", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const peopleNode = data.nodes.find((n: any) => n.id === "people");
      expect(peopleNode).toBeDefined();
    });

    it("includes person node paul", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const paulNode = data.nodes.find((n: any) => n.id === "paul");
      expect(paulNode).toBeDefined();
      expect(paulNode.type).toBe("person");
    });

    it("includes capability nodes from registry", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const mcpNode = data.nodes.find((n: any) => n.id === "mcp-development");
      expect(mcpNode).toBeDefined();
      expect(mcpNode.type).toBe("capability");
    });

    it("includes edges linking agent-readiness to team", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const edge = data.edges.find(
        (e: any) => e.from === "agent-readiness" && e.to === "team",
      );
      expect(edge).toBeDefined();
    });

    it("includes edges linking capabilities to services", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const edge = data.edges.find(
        (e: any) =>
          e.from === "mcp-development" && e.to === "services",
      );
      expect(edge).toBeDefined();
    });

    it("includes edges linking capabilities to people", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const edge = data.edges.find(
        (e: any) => e.from === "mcp-development" && e.to === "paul",
      );
      expect(edge).toBeDefined();
    });

    it("includes edge from paul to contact", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const edge = data.edges.find(
        (e: any) => e.from === "paul" && e.to === "contact",
      );
      expect(edge).toBeDefined();
    });

    it("maintains backward compatibility with existing nodes", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const existingIds = [
        "agent-readiness",
        "scanner",
        "scoring",
        "badge",
        "ruleset",
        "cli",
      ];
      for (const id of existingIds) {
        expect(data.nodes.find((n: any) => n.id === id)).toBeDefined();
      }
    });

    it("maintains backward compatibility with existing edges", async () => {
      const res = await app.request("/agent-guide/knowledge-map.json");
      const data = await res.json();
      const existingEdge = data.edges.find(
        (e: any) =>
          e.from === "agent-readiness" && e.to === "scanner",
      );
      expect(existingEdge).toBeDefined();
    });
  });

  describe("GET /llms.txt", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("includes Engineering Capabilities section", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("## Engineering Capabilities");
    });

    it("lists /agent-guide/team endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team — Team overview");
    });

    it("lists /agent-guide/team/capabilities endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/capabilities — Capabilities (Markdown)");
    });

    it("lists /agent-guide/team/capabilities.json endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/capabilities.json — Capabilities (JSON)");
    });

    it("lists /agent-guide/team/services endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/services — Services catalog");
    });

    it("lists /agent-guide/team/availability endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/availability — Availability");
    });

    it("lists /agent-guide/team/contact endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/contact — Contact channels");
    });

    it("lists /agent-guide/team/match endpoint", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/match — Matching criteria");
    });

    it("preserves existing llms.txt content", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("Agent Passport on Hedera");
    });
  });
});
