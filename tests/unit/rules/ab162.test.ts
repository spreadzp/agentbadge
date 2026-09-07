import { describe, it, expect } from "vitest";
import { AB162 } from "../../../src/agent-readiness/rules/AB162";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function mockSnap(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    url: "https://example.com/heartbeat.md",
    status: 200,
    headers: {},
    body: "",
    bodyHash: null,
    resolvedIp: null,
    fetchTimeMs: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  } as ResponseSnapshot;
}

describe("AB-162: Heartbeat.md availability", () => {
  describe("Rule definition", () => {
    it("has correct rule_id", () => {
      expect(AB162.rule_id).toBe("AB-162");
    });

    it("uses semantic_validation check type", () => {
      expect(AB162.check.type).toBe("semantic_validation");
    });

    it("has heartbeat source", () => {
      expect(AB162.check.sources).toContain("heartbeat");
    });

    it("has heartbeat_md semantic checker id", () => {
      expect((AB162.check as { semantic: string }).semantic).toBe("heartbeat_md");
    });

    it("is counted in score", () => {
      expect(AB162.counted_in_score).toBe(true);
    });

    it("has actionability category", () => {
      expect(AB162.category).toBe("actionability");
    });
  });

  describe("Checker: heartbeat_md", () => {
    it("checker is registered in SEMANTIC_CHECKERS", () => {
      expect(SEMANTIC_CHECKERS["heartbeat_md"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["heartbeat_md"]).toBe("function");
    });

    it("returns 'found' for valid heartbeat.md with frontmatter and keyword", () => {
      const snap = mockSnap({
        status: 200,
        body: "---\nstatus: operational\nlast_check: 2026-09-07\n---\n# Heartbeat\nService is operational.",
      });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("frontmatter");
    });

    it("returns 'found' when 'check-in' keyword is present instead of 'heartbeat'", () => {
      const snap = mockSnap({
        status: 200,
        body: "---\nstatus: ok\n---\n# Check-in\nAll systems go.",
      });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("found");
    });

    it("returns 'partial' for Markdown without YAML frontmatter", () => {
      const snap = mockSnap({
        status: 200,
        body: "# Heartbeat\nService is operational.",
      });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("frontmatter");
    });

    it("returns 'partial' when frontmatter present but no heartbeat/check-in keyword", () => {
      const snap = mockSnap({
        status: 200,
        body: "---\ntitle: Status\n---\n# Status Page\nAll good.",
      });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("keyword");
    });

    it("returns 'absent' for HTTP 404", () => {
      const snap = mockSnap({ status: 404, body: "Not Found" });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("404");
    });

    it("returns 'absent' for HTTP 500", () => {
      const snap = mockSnap({ status: 500, body: "Internal Server Error" });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("500");
    });

    it("returns 'absent' for empty body", () => {
      const snap = mockSnap({ status: 200, body: "" });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("empty");
    });

    it("returns 'absent' for network error (status 0)", () => {
      const snap = mockSnap({ status: 0, body: null });
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'no_source' when heartbeat snapshot is null", () => {
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({ heartbeat: null });
      expect(result.outcome).toBe("no_source");
      expect(result.detail).toContain("not found");
    });

    it("returns 'no_source' when heartbeat key is missing", () => {
      const result = SEMANTIC_CHECKERS["heartbeat_md"]({});
      expect(result.outcome).toBe("no_source");
    });
  });
});
