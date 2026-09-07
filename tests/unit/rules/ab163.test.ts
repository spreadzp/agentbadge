import { describe, it, expect } from "vitest";
import { AB163 } from "../../../src/agent-readiness/rules/AB163";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function mockSnap(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    url: "https://example.com/skill.json",
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

describe("AB-163: Skill.json (JSON-LD) availability", () => {
  describe("Rule definition", () => {
    it("has correct rule_id", () => {
      expect(AB163.rule_id).toBe("AB-163");
    });

    it("uses semantic_validation check type", () => {
      expect(AB163.check.type).toBe("semantic_validation");
    });

    it("has skill_json source", () => {
      expect(AB163.check.sources).toContain("skill_json");
    });

    it("has skill_json_ld semantic checker id", () => {
      expect((AB163.check as { semantic: string }).semantic).toBe("skill_json_ld");
    });

    it("is counted in score", () => {
      expect(AB163.counted_in_score).toBe(true);
    });

    it("has machine_readable category", () => {
      expect(AB163.category).toBe("machine_readable");
    });
  });

  describe("Checker: skill_json_ld", () => {
    it("checker is registered in SEMANTIC_CHECKERS", () => {
      expect(SEMANTIC_CHECKERS["skill_json_ld"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["skill_json_ld"]).toBe("function");
    });

    it("returns 'found' for valid JSON-LD with @context, @type, name, url", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "MyAgent",
          url: "https://example.com/docs",
        }),
      });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("url");
    });

    it("returns 'found' when endpoints present instead of url", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "MyAgent",
          endpoints: ["/api/v1", "/api/v2"],
        }),
      });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("endpoints");
    });

    it("returns 'partial' when @context is missing", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          "@type": "SoftwareApplication",
          name: "MyAgent",
          url: "https://example.com",
        }),
      });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("@context");
    });

    it("returns 'partial' when @type is missing", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          "@context": "https://schema.org",
          name: "MyAgent",
          url: "https://example.com",
        }),
      });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("@type");
    });

    it("returns 'partial' when name is missing", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          url: "https://example.com",
        }),
      });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("name");
    });

    it("returns 'partial' when both url and endpoints are missing", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "MyAgent",
        }),
      });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("url or endpoints");
    });

    it("returns 'absent' for HTTP 404", () => {
      const snap = mockSnap({ status: 404, body: "Not Found" });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'absent' for invalid JSON", () => {
      const snap = mockSnap({ status: 200, body: "not json at all" });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("not valid JSON");
    });

    it("returns 'absent' for empty body", () => {
      const snap = mockSnap({ status: 200, body: "" });
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'no_source' when skill_json snapshot is null", () => {
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({ skill_json: null });
      expect(result.outcome).toBe("no_source");
    });

    it("returns 'no_source' when skill_json key is missing", () => {
      const result = SEMANTIC_CHECKERS["skill_json_ld"]({});
      expect(result.outcome).toBe("no_source");
    });
  });
});
