import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-3: Agent Team Routes", () => {
  describe("GET /agent-guide/team (overview)", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/team");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains team heading", async () => {
      const res = await app.request("/agent-guide/team");
      const text = await res.text();
      expect(text).toContain("Engineering Team");
    });

    it("contains active members count", async () => {
      const res = await app.request("/agent-guide/team");
      const text = await res.text();
      expect(text).toContain("Active members");
    });

    it("contains capabilities overview", async () => {
      const res = await app.request("/agent-guide/team");
      const text = await res.text();
      expect(text).toContain("Capabilities overview");
    });

    it("contains links to detailed endpoints", async () => {
      const res = await app.request("/agent-guide/team");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/capabilities");
      expect(text).toContain("/agent-guide/team/services");
      expect(text).toContain("/agent-guide/team/availability");
      expect(text).toContain("/agent-guide/team/contact");
      expect(text).toContain("/agent-guide/team/match");
    });

    it("contains capability names from registry", async () => {
      const res = await app.request("/agent-guide/team");
      const text = await res.text();
      expect(text).toContain("MCP Server Development");
      expect(text).toContain("Blockchain Development");
    });

    it("contains confidence scores", async () => {
      const res = await app.request("/agent-guide/team");
      const text = await res.text();
      expect(text).toContain("confidence");
    });
  });

  describe("GET /agent-guide/team/services", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/team/services");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains services heading", async () => {
      const res = await app.request("/agent-guide/team/services");
      const text = await res.text();
      expect(text).toContain("Engineering Services");
    });

    it("contains all services from registry", async () => {
      const res = await app.request("/agent-guide/team/services");
      const text = await res.text();
      expect(text).toContain("MCP Server Development");
      expect(text).toContain("Smart Contract Development");
      expect(text).toContain("AI Agent Consulting");
      expect(text).toContain("GEO Consulting");
    });

    it("contains problem for each service", async () => {
      const res = await app.request("/agent-guide/team/services");
      const text = await res.text();
      expect(text).toContain("Problem:");
    });

    it("contains deliverables for each service", async () => {
      const res = await app.request("/agent-guide/team/services");
      const text = await res.text();
      expect(text).toContain("Deliverables:");
    });

    it("contains engagement types", async () => {
      const res = await app.request("/agent-guide/team/services");
      const text = await res.text();
      expect(text).toContain("Engagement:");
    });

    it("contains contact info", async () => {
      const res = await app.request("/agent-guide/team/services");
      const text = await res.text();
      expect(text).toContain("Contact:");
    });
  });

  describe("GET /agent-guide/team/availability", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/team/availability");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains availability heading", async () => {
      const res = await app.request("/agent-guide/team/availability");
      const text = await res.text();
      expect(text).toContain("Availability");
    });

    it("contains engagement types section", async () => {
      const res = await app.request("/agent-guide/team/availability");
      const text = await res.text();
      expect(text).toContain("Engagement types");
    });

    it("contains current capacity section", async () => {
      const res = await app.request("/agent-guide/team/availability");
      const text = await res.text();
      expect(text).toContain("Current capacity");
    });

    it("contains person names", async () => {
      const res = await app.request("/agent-guide/team/availability");
      const text = await res.text();
      expect(text).toContain("Paul");
    });

    it("contains availability status", async () => {
      const res = await app.request("/agent-guide/team/availability");
      const text = await res.text();
      expect(text).toContain("available");
    });
  });

  describe("GET /agent-guide/team/contact", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/team/contact");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains contact heading", async () => {
      const res = await app.request("/agent-guide/team/contact");
      const text = await res.text();
      expect(text).toContain("Team Contact");
    });

    it("contains person names", async () => {
      const res = await app.request("/agent-guide/team/contact");
      const text = await res.text();
      expect(text).toContain("Paul");
    });

    it("contains primary channel", async () => {
      const res = await app.request("/agent-guide/team/contact");
      const text = await res.text();
      expect(text).toContain("Primary channel");
    });

    it("contains available channels", async () => {
      const res = await app.request("/agent-guide/team/contact");
      const text = await res.text();
      expect(text).toContain("Available channels");
    });

    it("contains telegram channel from registry", async () => {
      const res = await app.request("/agent-guide/team/contact");
      const text = await res.text();
      expect(text).toContain("telegram");
    });

    it("contains mediated contact note", async () => {
      const res = await app.request("/agent-guide/team/contact");
      const text = await res.text();
      expect(text).toContain("mediated");
    });
  });

  describe("GET /agent-guide/team/match", () => {
    it("returns 200 + text/markdown", async () => {
      const res = await app.request("/agent-guide/team/match");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains matching criteria heading", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("Matching Criteria");
    });

    it("contains available skills section", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("Available skills");
    });

    it("contains skill count", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("Total:");
    });

    it("contains High match rule (100%)", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("High");
      expect(text).toContain("100%");
    });

    it("contains Medium match rule (>=50%)", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("Medium");
      expect(text).toContain("50%");
    });

    it("contains Low match rule (<50%)", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("Low");
      expect(text).toContain("<50%");
    });

    it("contains how to use instructions", async () => {
      const res = await app.request("/agent-guide/team/match");
      const text = await res.text();
      expect(text).toContain("How to use");
    });
  });
});
