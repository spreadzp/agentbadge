import { describe, it, expect } from "vitest";
import { landingRoutes } from "../../src/server/routes/landing";

const app = landingRoutes;

describe("SLICE-49-9: WebMCP browser-side tools", () => {

  describe("GET / — homepage HTML includes WebMCP", () => {
    it("includes navigator.modelContext reference", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("navigator.modelContext");
    });

    it("includes provideContext call", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("provideContext");
    });

    it("includes at least one tool definition with inputSchema", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("inputSchema");
    });

    it("includes at least one tool definition with execute", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("execute");
    });

    it("includes agent-readiness-scan tool", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("agent-readiness-scan");
    });

    it("includes badge-generate tool", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("badge-generate");
    });

    it("includes passport-issue tool", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("passport-issue");
    });

    it("script is guarded for browsers without WebMCP support", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("'modelContext' in navigator");
    });
  });
});
