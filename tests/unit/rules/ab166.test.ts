import { describe, it, expect } from "vitest";
import { AB166 } from "../../../src/agent-readiness/rules/AB166";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function mockSnap(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    url: "https://example.com/openapi.json",
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

const SPEC_WITH_NEXT_CALL = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/catalog": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array" },
                    next_call: {
                      type: "object",
                      properties: {
                        method: { type: "string" },
                        path: { type: "string" },
                        why: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

const SPEC_WITH_NEXT_CALL_IN_EXAMPLE = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/items": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "array" } } },
                examples: {
                  default: {
                    value: {
                      data: [{ id: 1 }],
                      next_call: { method: "GET", path: "/items/1", why: "Fetch item details" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

const SPEC_WITH_NEXT_CALL_PARTIAL = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/catalog": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    next_call: {
                      type: "object",
                      properties: {
                        method: { type: "string" },
                        // missing path and why
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

const SPEC_WITHOUT_NEXT_CALL = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/catalog": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "array" } } },
              },
            },
          },
        },
      },
    },
  },
});

const SPEC_NEXT_CALL_IN_DESCRIPTION = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/catalog": {
      get: {
        description: "Responses include next_call field for agent navigation",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "array" } } },
              },
            },
          },
        },
      },
    },
  },
});

describe("AB-166: next_call pattern in API responses", () => {
  describe("Rule definition", () => {
    it("has correct rule_id", () => {
      expect(AB166.rule_id).toBe("AB-166");
    });

    it("uses semantic_validation check type", () => {
      expect(AB166.check.type).toBe("semantic_validation");
    });

    it("has openapi_standard source", () => {
      expect(AB166.check.sources).toContain("openapi_standard");
    });

    it("has next_call_pattern semantic checker id", () => {
      expect((AB166.check as { semantic: string }).semantic).toBe("next_call_pattern");
    });

    it("is counted in score", () => {
      expect(AB166.counted_in_score).toBe(true);
    });

    it("has actionability category", () => {
      expect(AB166.category).toBe("actionability");
    });
  });

  describe("Checker: next_call_pattern", () => {
    it("checker is registered in SEMANTIC_CHECKERS", () => {
      expect(SEMANTIC_CHECKERS["next_call_pattern"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["next_call_pattern"]).toBe("function");
    });

    it("returns 'found' for next_call in response schema with method, path, why", () => {
      const snap = mockSnap({ status: 200, body: SPEC_WITH_NEXT_CALL });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("method, path, and why");
    });

    it("returns 'found' for next_call in response example with method, path, why", () => {
      const snap = mockSnap({ status: 200, body: SPEC_WITH_NEXT_CALL_IN_EXAMPLE });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("found");
    });

    it("returns 'partial' for next_call with missing sub-fields", () => {
      const snap = mockSnap({ status: 200, body: SPEC_WITH_NEXT_CALL_PARTIAL });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("missing required sub-fields");
    });

    it("returns 'partial' for next_call mentioned in description but not in schema", () => {
      const snap = mockSnap({ status: 200, body: SPEC_NEXT_CALL_IN_DESCRIPTION });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("not found in structured");
    });

    it("returns 'absent' for spec without next_call", () => {
      const snap = mockSnap({ status: 200, body: SPEC_WITHOUT_NEXT_CALL });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("No next_call");
    });

    it("returns 'absent' for HTTP 404", () => {
      const snap = mockSnap({ status: 404, body: "" });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'absent' for invalid JSON", () => {
      const snap = mockSnap({ status: 200, body: "not json" });
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("not valid JSON");
    });

    it("returns 'no_source' when openapi_standard snapshot is null", () => {
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({ openapi_standard: null });
      expect(result.outcome).toBe("no_source");
    });

    it("returns 'no_source' when openapi_standard key is missing", () => {
      const result = SEMANTIC_CHECKERS["next_call_pattern"]({});
      expect(result.outcome).toBe("no_source");
    });
  });
});
