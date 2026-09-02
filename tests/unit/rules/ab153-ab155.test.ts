import { describe, it, expect } from "vitest";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { AB153 } from "../../../src/agent-readiness/rules/AB153";
import { AB154 } from "../../../src/agent-readiness/rules/AB154";
import { AB155 } from "../../../src/agent-readiness/rules/AB155";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

// ─── Helpers ───────────────────────────────────────────────────────────────

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

// ─── Fixtures ──────────────────────────────────────────────────────────────

// (a) Full auth docs: OpenAPI securitySchemes + guide auth section → VERIFIED
const openapiWithAuth = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0" },
    paths: {
      "/v1/users": {
        get: {
          operationId: "listUsers",
          responses: {
            "200": { description: "OK" },
            "429": { description: "Rate limited. Retry-After header indicates wait time." },
          },
        },
        post: {
          operationId: "createUser",
          parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } }],
          responses: { "201": { description: "Created" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Bearer token auth. Obtain credentials by registering at /auth/register to get a client_id and secret.",
        },
      },
    },
  }),
);

const guideWithAuth = mockSnap(
  "https://example.com/.well-known/agent-guide.json",
  JSON.stringify({
    name: "Example API",
    auth: {
      type: "bearer",
      credential_location: "Authorization header",
      how_to_obtain: "Register at /auth/register to obtain a client_id and secret, then exchange for a bearer token at /auth/token",
    },
    retry: {
      idempotency_key: "Use Idempotency-Key header for POST requests",
      retry_after: "Retry-After header on 429 responses",
      guidance: "Use exponential backoff. Safe to retry idempotent requests.",
    },
    versioning: {
      current: "v1",
      deprecation_policy: "6 months notice via Sunset header before removal",
    },
  }),
);

// (b) Bare spec without securitySchemes, guide silent → GAP + critical
const openapiBare = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Bare API", version: "0.1" },
    paths: {
      "/users": {
        get: {
          operationId: "listUsers",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  }),
);

const guideBare = mockSnap(
  "https://example.com/guide",
  "A simple API for developers.",
);

// (c) Idempotency declared, no retry-after → INFERRED
const openapiIdempotencyOnly = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Partial API", version: "1.0.0" },
    paths: {
      "/v1/charges": {
        post: {
          operationId: "createCharge",
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Created" }, "500": { description: "Server error" } },
        },
      },
    },
  }),
);

const guideIdempotencyOnly = mockSnap(
  "https://example.com/guide",
  "## API Guide\n\nUse Idempotency-Key header for safe retries on POST requests.\n",
);

// (d) Versioned paths + sunset header → VERIFIED
const openapiVersioned = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Versioned API", version: "2.1.0" },
    paths: {
      "/v2/items": {
        get: {
          operationId: "listItems",
          responses: {
            "200": { description: "OK" },
            "410": {
              description: "Gone. This API version is deprecated.",
              headers: {
                Sunset: { schema: { type: "string" }, description: "Date when this version will be removed" },
              },
            },
          },
        },
      },
    },
  }),
);

const guideWithDeprecation = mockSnap(
  "https://example.com/guide",
  "## Versioning\n\nCurrent version: v2. Deprecated versions get 6 months notice via Sunset header.\n",
);

// (e) Guide-only auth docs (no OpenAPI securitySchemes)
const guideAuthOnly = mockSnap(
  "https://example.com/guide",
  "## Authentication\n\nThis API uses Bearer token auth. Send the token in the Authorization header as 'Bearer <token>'. To obtain credentials, register at /auth/register and exchange your client_id for a token at /auth/token.",
);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-95-6: Execution Semantics Rules (AB-153..AB-155)", () => {

  // ─── AB-153: Authentication clarity ───────────────────────────────────────
  describe("AB-153: Authentication clarity (authentication_clarity)", () => {
    it("rule definition is correct", () => {
      expect(AB153.rule_id).toBe("AB-153");
      expect(AB153.check.type).toBe("semantic_validation");
      expect(AB153.check.semantic).toBe("authentication_clarity");
      expect(AB153.check.sources).toEqual(["openapi", "guide"]);
      expect(AB153.category).toBe("bot_auth");
      expect(AB153.severity).toBe("critical");
      expect(AB153.counted_in_score).toBe(true);
    });

    it("full auth docs (openapi securitySchemes + guide) → found", () => {
      const result = SEMANTIC_CHECKERS["authentication_clarity"]({
        openapi: openapiWithAuth,
        guide: guideWithAuth,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("Auth scheme");
    });

    it("guide-only auth docs (no openapi securitySchemes) → found if all elements present", () => {
      const result = SEMANTIC_CHECKERS["authentication_clarity"]({
        openapi: openapiBare,
        guide: guideAuthOnly,
      });
      expect(result.outcome).toBe("found");
    });

    it("bare spec without securitySchemes, guide silent → absent", () => {
      const result = SEMANTIC_CHECKERS["authentication_clarity"]({
        openapi: openapiBare,
        guide: guideBare,
      });
      expect(result.outcome).toBe("absent");
    });

    it("securitySchemes present but no description → partial", () => {
      const openapiNoDesc = mockSnap(
        "https://example.com/openapi.json",
        JSON.stringify({
          openapi: "3.1.0",
          paths: {},
          components: {
            securitySchemes: {
              bearerAuth: { type: "http", scheme: "bearer" },
            },
          },
        }),
      );
      const result = SEMANTIC_CHECKERS["authentication_clarity"]({
        openapi: openapiNoDesc,
        guide: guideBare,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["authentication_clarity"]({
        openapi: null,
        guide: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-154: Retry semantics declared ─────────────────────────────────────
  describe("AB-154: Retry semantics declared (retry_semantics_declared)", () => {
    it("rule definition is correct", () => {
      expect(AB154.rule_id).toBe("AB-154");
      expect(AB154.check.type).toBe("semantic_validation");
      expect(AB154.check.semantic).toBe("retry_semantics_declared");
      expect(AB154.check.sources).toEqual(["openapi", "guide"]);
      expect(AB154.category).toBe("retry_semantics");
      expect(AB154.severity).toBe("medium");
    });

    it("idempotency + retry-after + guidance → found", () => {
      const result = SEMANTIC_CHECKERS["retry_semantics_declared"]({
        openapi: openapiWithAuth,
        guide: guideWithAuth,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("idempotency");
    });

    it("idempotency only, no retry-after → partial", () => {
      const result = SEMANTIC_CHECKERS["retry_semantics_declared"]({
        openapi: openapiIdempotencyOnly,
        guide: guideIdempotencyOnly,
      });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("idempotency");
    });

    it("no retry semantics → absent", () => {
      const result = SEMANTIC_CHECKERS["retry_semantics_declared"]({
        openapi: openapiBare,
        guide: guideBare,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["retry_semantics_declared"]({
        openapi: null,
        guide: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-155: Versioning declared ──────────────────────────────────────────
  describe("AB-155: Versioning declared (versioning_declared)", () => {
    it("rule definition is correct", () => {
      expect(AB155.rule_id).toBe("AB-155");
      expect(AB155.check.type).toBe("semantic_validation");
      expect(AB155.check.semantic).toBe("versioning_declared");
      expect(AB155.check.sources).toEqual(["openapi", "guide"]);
      expect(AB155.category).toBe("versioning");
      expect(AB155.severity).toBe("medium");
    });

    it("versioned paths + sunset header + deprecation policy → found", () => {
      const result = SEMANTIC_CHECKERS["versioning_declared"]({
        openapi: openapiVersioned,
        guide: guideWithDeprecation,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("version");
    });

    it("version present but no deprecation policy → partial", () => {
      const result = SEMANTIC_CHECKERS["versioning_declared"]({
        openapi: openapiBare,
        guide: guideBare,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no version info at all → absent", () => {
      const openapiNoVersion = mockSnap(
        "https://example.com/openapi.json",
        JSON.stringify({ openapi: "3.1.0", paths: {} }),
      );
      const result = SEMANTIC_CHECKERS["versioning_declared"]({
        openapi: openapiNoVersion,
        guide: guideBare,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["versioning_declared"]({
        openapi: null,
        guide: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── Claims are semantic statements ───────────────────────────────────────
  describe("Claims are semantic (not rule names)", () => {
    it("AB-153 name is a semantic claim", () => {
      expect(AB153.name).not.toBe("AB-153");
      expect(AB153.name.length).toBeGreaterThan(3);
    });

    it("AB-154 name is a semantic claim", () => {
      expect(AB154.name).not.toBe("AB-154");
      expect(AB154.name.length).toBeGreaterThan(3);
    });

    it("AB-155 name is a semantic claim", () => {
      expect(AB155.name).not.toBe("AB-155");
      expect(AB155.name.length).toBeGreaterThan(3);
    });
  });

  // ─── Determinism ──────────────────────────────────────────────────────────
  describe("Pure checkers: deterministic", () => {
    it("authentication_clarity is deterministic", () => {
      const sources = { openapi: openapiWithAuth, guide: guideWithAuth };
      const r1 = SEMANTIC_CHECKERS["authentication_clarity"](sources);
      const r2 = SEMANTIC_CHECKERS["authentication_clarity"](sources);
      expect(r1).toEqual(r2);
    });

    it("retry_semantics_declared is deterministic", () => {
      const sources = { openapi: openapiWithAuth, guide: guideWithAuth };
      const r1 = SEMANTIC_CHECKERS["retry_semantics_declared"](sources);
      const r2 = SEMANTIC_CHECKERS["retry_semantics_declared"](sources);
      expect(r1).toEqual(r2);
    });

    it("versioning_declared is deterministic", () => {
      const sources = { openapi: openapiVersioned, guide: guideWithDeprecation };
      const r1 = SEMANTIC_CHECKERS["versioning_declared"](sources);
      const r2 = SEMANTIC_CHECKERS["versioning_declared"](sources);
      expect(r1).toEqual(r2);
    });
  });
});
