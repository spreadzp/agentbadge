import { describe, it, expect } from "vitest";
import { hackathonRoutes } from "../../src/server/routes/pages/hackathon";

const app = hackathonRoutes;

describe("SLICE-49-9: WebMCP browser-side tools", () => {

  describe("GET /hackathon/webmcp — WebMCP page HTML includes WebMCP", () => {
    it("includes document.modelContext reference", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("document.modelContext");
    });

    it("includes registerTool call", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("registerTool");
    });

    it("includes at least one tool definition with inputSchema", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("inputSchema");
    });

    it("includes at least one tool definition with execute", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("execute");
    });

    it("includes agent-readiness-scan tool", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("agent-readiness-scan");
    });

    it("includes badge-generate tool", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("badge-generate");
    });

    it("includes new SLICE-256-2 tools, not removed passport-issue", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).not.toContain("passport-issue");
      expect(html).toContain("verify-verdict");
      expect(html).toContain("browse-tasks");
      expect(html).toContain("how-to-register");
    });

    it("script is guarded for browsers without WebMCP support", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("'modelContext' in document");
    });
  });
});
