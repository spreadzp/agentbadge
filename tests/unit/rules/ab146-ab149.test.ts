import { describe, it, expect } from "vitest";
import {
  SEMANTIC_CHECKERS,
  parseJsonBody,
} from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { AB146 } from "../../../src/agent-readiness/rules/AB146";
import { AB147 } from "../../../src/agent-readiness/rules/AB147";
import { AB148 } from "../../../src/agent-readiness/rules/AB148";
import { AB149 } from "../../../src/agent-readiness/rules/AB149";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const mockSnap = (url: string, body?: string | null, status = 200): ResponseSnapshot => ({
  url,
  status,
  bodyHash: "abc123",
  bodySize: body?.length ?? 0,
  contentType: body ? "application/json" : "text/plain",
  resolvedIp: "93.184.216.34",
  fetchedAt: "2025-01-01T00:00:00Z",
  fetchTimeMs: 100,
  redirectChain: [],
  body,
  headers: {},
});

// Rich OpenAPI: descriptions, parameter descriptions+constraints, examples, error schemas with problem+json
const richOpenApi = JSON.stringify({
  openapi: "3.1.0",
  paths: {
    "/api/users": {
      get: {
        description: "List all users with pagination support",
        parameters: [
          {
            name: "limit",
            in: "query",
            description: "Maximum number of users to return",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          {
            name: "offset",
            in: "query",
            description: "Number of users to skip for pagination",
            required: false,
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: {
          "200": {
            description: "Successful response with user list",
            content: {
              "application/json": {
                example: [{ id: 1, name: "Alice" }],
              },
            },
          },
          "400": {
            description: "Bad request — invalid query parameters",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "404": {
            description: "Resource not found",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
      post: {
        description: "Create a new user account",
        requestBody: {
          content: {
            "application/json": {
              example: { name: "Bob", email: "bob@example.com" },
            },
          },
        },
        responses: {
          "201": {
            description: "User created successfully",
            content: {
              "application/json": {
                example: { id: 2, name: "Bob" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        description: "RFC 9457 problem details",
        properties: {
          type: { type: "string", description: "Error type URI" },
          title: { type: "string", description: "Error title" },
          status: { type: "integer", description: "HTTP status code" },
        },
      },
    },
  },
});

// Bare OpenAPI: no descriptions, no parameter descriptions, no examples, no error schemas
const bareOpenApi = JSON.stringify({
  openapi: "3.1.0",
  paths: {
    "/api/users": {
      get: {
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          "200": {},
          "400": {},
        },
      },
      post: {
        responses: {
          "201": {},
          "400": {},
        },
      },
    },
  },
});

// Partial OpenAPI: some descriptions, some params described, schema-only examples, some error descriptions
const partialOpenApi = JSON.stringify({
  openapi: "3.1.0",
  paths: {
    "/api/users": {
      get: {
        description: "List all users",
        parameters: [
          { name: "limit", in: "query", description: "Maximum results to return", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          "200": {},
          "400": {
            description: "Bad request",
          },
        },
      },
      post: {
        responses: {
          "201": {},
          "400": {},
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
        },
      },
    },
  },
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-95-4: OpenAPI Semantic Rules (AB-146..AB-149)", () => {
  // ─── AB-146: Capability descriptions ─────────────────────────────────────
  describe("AB-146: Capability descriptions (openapi_operation_descriptions)", () => {
    it("rule definition is correct", () => {
      expect(AB146.rule_id).toBe("AB-146");
      expect(AB146.check.type).toBe("semantic_validation");
      expect(AB146.check.semantic).toBe("openapi_operation_descriptions");
      expect(AB146.check.sources).toEqual(["openapi"]);
      expect(AB146.category).toBe("actionability");
      expect(AB146.severity).toBe("high");
      expect(AB146.counted_in_score).toBe(true);
    });

    it("rich spec → found (all operations have descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", richOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_operation_descriptions"]({ openapi: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("2 operations have descriptions");
    });

    it("bare spec → absent (no descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", bareOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_operation_descriptions"]({ openapi: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("missing descriptions");
    });

    it("partial spec → partial (some descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", partialOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_operation_descriptions"]({ openapi: snap });
      expect(result.outcome).toBe("partial");
    });

    it("no openapi snapshot → no_source", () => {
      const result = SEMANTIC_CHECKERS["openapi_operation_descriptions"]({ openapi: null });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-147: Parameter semantics ─────────────────────────────────────────
  describe("AB-147: Parameter semantics (openapi_parameter_semantics)", () => {
    it("rule definition is correct", () => {
      expect(AB147.rule_id).toBe("AB-147");
      expect(AB147.check.type).toBe("semantic_validation");
      expect(AB147.check.semantic).toBe("openapi_parameter_semantics");
      expect(AB147.check.sources).toEqual(["openapi"]);
      expect(AB147.category).toBe("documentation");
      expect(AB147.severity).toBe("medium");
    });

    it("rich spec → found (all parameters have descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", richOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_parameter_semantics"]({ openapi: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("2 parameters have descriptions");
    });

    it("bare spec → absent (no parameter descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", bareOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_parameter_semantics"]({ openapi: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("missing descriptions");
    });

    it("partial spec → partial (some parameter descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", partialOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_parameter_semantics"]({ openapi: snap });
      expect(result.outcome).toBe("partial");
    });

    it("no openapi snapshot → no_source", () => {
      const result = SEMANTIC_CHECKERS["openapi_parameter_semantics"]({ openapi: null });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-148: Request and response examples ───────────────────────────────
  describe("AB-148: Request and response examples (openapi_examples)", () => {
    it("rule definition is correct", () => {
      expect(AB148.rule_id).toBe("AB-148");
      expect(AB148.check.type).toBe("semantic_validation");
      expect(AB148.check.semantic).toBe("openapi_examples");
      expect(AB148.check.sources).toEqual(["openapi"]);
      expect(AB148.category).toBe("documentation");
      expect(AB148.severity).toBe("medium");
    });

    it("rich spec → found (request and response examples)", () => {
      const snap = mockSnap("https://example.com/openapi.json", richOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_examples"]({ openapi: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("request");
      expect(result.detail).toContain("response");
    });

    it("bare spec → absent (no examples)", () => {
      const snap = mockSnap("https://example.com/openapi.json", bareOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_examples"]({ openapi: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("No examples");
    });

    it("partial spec → partial (schema-only examples)", () => {
      const snap = mockSnap("https://example.com/openapi.json", partialOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_examples"]({ openapi: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("schema");
    });

    it("no openapi snapshot → no_source", () => {
      const result = SEMANTIC_CHECKERS["openapi_examples"]({ openapi: null });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-149: Error semantics ─────────────────────────────────────────────
  describe("AB-149: Error semantics (openapi_error_schemas)", () => {
    it("rule definition is correct", () => {
      expect(AB149.rule_id).toBe("AB-149");
      expect(AB149.check.type).toBe("semantic_validation");
      expect(AB149.check.semantic).toBe("openapi_error_schemas");
      expect(AB149.check.sources).toEqual(["openapi"]);
      expect(AB149.category).toBe("error_semantics");
      expect(AB149.severity).toBe("high");
    });

    it("rich spec → found (all operations have error schemas with problem+json)", () => {
      const snap = mockSnap("https://example.com/openapi.json", richOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_error_schemas"]({ openapi: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("error schemas");
      expect(result.detail).toContain("problem+json");
    });

    it("bare spec → absent (error responses declared but no schemas/descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", bareOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_error_schemas"]({ openapi: snap });
      expect(result.outcome).toBe("absent");
    });

    it("partial spec → partial (some operations have error descriptions)", () => {
      const snap = mockSnap("https://example.com/openapi.json", partialOpenApi);
      const result = SEMANTIC_CHECKERS["openapi_error_schemas"]({ openapi: snap });
      expect(result.outcome).toBe("partial");
    });

    it("no openapi snapshot → no_source", () => {
      const result = SEMANTIC_CHECKERS["openapi_error_schemas"]({ openapi: null });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── Claims are semantic statements ──────────────────────────────────────
  describe("Claims are semantic (not rule names)", () => {
    it("AB-146 name is a semantic claim", () => {
      expect(AB146.name).not.toBe("AB-146");
      expect(AB146.name.length).toBeGreaterThan(3);
    });

    it("AB-147 name is a semantic claim", () => {
      expect(AB147.name).not.toBe("AB-147");
      expect(AB147.name.length).toBeGreaterThan(3);
    });

    it("AB-148 name is a semantic claim", () => {
      expect(AB148.name).not.toBe("AB-148");
      expect(AB148.name.length).toBeGreaterThan(3);
    });

    it("AB-149 name is a semantic claim", () => {
      expect(AB149.name).not.toBe("AB-149");
      expect(AB149.name.length).toBeGreaterThan(3);
    });
  });

  // ─── Determinism ─────────────────────────────────────────────────────────
  describe("Pure checkers: deterministic (same input → same result)", () => {
    it("openapi_examples is deterministic", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", richOpenApi) };
      const r1 = SEMANTIC_CHECKERS["openapi_examples"](sources);
      const r2 = SEMANTIC_CHECKERS["openapi_examples"](sources);
      expect(r1).toEqual(r2);
    });

    it("openapi_error_schemas is deterministic", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", richOpenApi) };
      const r1 = SEMANTIC_CHECKERS["openapi_error_schemas"](sources);
      const r2 = SEMANTIC_CHECKERS["openapi_error_schemas"](sources);
      expect(r1).toEqual(r2);
    });
  });

  // ─── parseJsonBody helper ────────────────────────────────────────────────
  describe("parseJsonBody", () => {
    it("parses valid JSON from snapshot", () => {
      const snap = mockSnap("https://example.com/openapi.json", richOpenApi);
      const result = parseJsonBody(snap);
      expect(result).not.toBeNull();
      expect((result as Record<string, unknown>).openapi).toBe("3.1.0");
    });

    it("returns null for invalid JSON", () => {
      const snap = mockSnap("https://example.com/openapi.json", "not json");
      const result = parseJsonBody(snap);
      expect(result).toBeNull();
    });

    it("returns null for empty body", () => {
      const snap = mockSnap("https://example.com/openapi.json", null);
      const result = parseJsonBody(snap);
      expect(result).toBeNull();
    });
  });
});
