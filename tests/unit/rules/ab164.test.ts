import { describe, it, expect } from "vitest";
import { AB164 } from "../../../src/agent-readiness/rules/AB164";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function mockSnap(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    url: "https://example.com/api/meta/errors",
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

describe("AB-164: Error catalog endpoint", () => {
  describe("Rule definition", () => {
    it("has correct rule_id", () => {
      expect(AB164.rule_id).toBe("AB-164");
    });

    it("uses semantic_validation check type", () => {
      expect(AB164.check.type).toBe("semantic_validation");
    });

    it("has error_catalog source", () => {
      expect(AB164.check.sources).toContain("error_catalog");
    });

    it("has error_catalog semantic checker id", () => {
      expect((AB164.check as { semantic: string }).semantic).toBe("error_catalog");
    });

    it("is counted in score", () => {
      expect(AB164.counted_in_score).toBe(true);
    });
  });

  describe("Checker: error_catalog", () => {
    it("checker is registered in SEMANTIC_CHECKERS", () => {
      expect(SEMANTIC_CHECKERS["error_catalog"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["error_catalog"]).toBe("function");
    });

    it("returns 'found' for valid array of errors with code field", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify([
          { code: "RATE_LIMITED", description: "Too many requests" },
          { code: "INVALID_INPUT", description: "Validation failed" },
        ]),
      });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("2");
    });

    it("returns 'found' for object with errors array", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          errors: [
            { code: "NOT_FOUND", description: "Resource not found" },
          ],
        }),
      });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("found");
    });

    it("returns 'found' when entries use 'id' instead of 'code'", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify([
          { id: "ERR_001", message: "Something went wrong" },
        ]),
      });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("found");
    });

    it("returns 'partial' for empty errors array", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify([]),
      });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("no error entries");
    });

    it("returns 'partial' when entries lack code/error/id fields", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify([
          { message: "Something went wrong" },
          { type: "warning" },
        ]),
      });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("code");
    });

    it("returns 'absent' for HTTP 404", () => {
      const snap = mockSnap({ status: 404, body: "" });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'absent' for invalid JSON", () => {
      const snap = mockSnap({ status: 200, body: "not json" });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("not valid JSON");
    });

    it("returns 'absent' for empty body (404 with empty string)", () => {
      const snap = mockSnap({ status: 404, body: "" });
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'no_source' when error_catalog snapshot is null", () => {
      const result = SEMANTIC_CHECKERS["error_catalog"]({ error_catalog: null });
      expect(result.outcome).toBe("no_source");
    });

    it("returns 'no_source' when error_catalog key is missing", () => {
      const result = SEMANTIC_CHECKERS["error_catalog"]({});
      expect(result.outcome).toBe("no_source");
    });
  });
});
