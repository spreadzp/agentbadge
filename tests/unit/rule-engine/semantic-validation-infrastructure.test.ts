import { describe, it, expect } from "vitest";
import {
  SEMANTIC_CHECKERS,
  parseJsonBody,
  type SemanticCheckResult,
} from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { StatusDeterminator } from "../../../src/agent-readiness/rule-engine/status-determinator";
import { ConfidenceComputer } from "../../../src/agent-readiness/rule-engine/confidence";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";
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
  fetchTimeMs: 50,
  redirectChain: [],
  body: body ?? null,
});

const richOpenApi = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/api/users": {
      get: {
        description: "List all users",
        parameters: [
          { name: "limit", in: "query", description: "Maximum results", required: false, schema: { type: "integer" } },
        ],
      },
      post: {
        description: "Create a user",
        parameters: [],
      },
    },
    "/api/orders": {
      get: {
        description: "List orders",
        parameters: [
          { name: "status", in: "query", description: "Filter by status", required: true, schema: { type: "string" } },
        ],
      },
    },
  },
});

const bareOpenApi = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/api/users": {
      get: {},
      post: {},
    },
    "/api/orders": {
      get: {},
    },
  },
});

const partialOpenApi = JSON.stringify({
  openapi: "3.0.0",
  paths: {
    "/api/users": {
      get: {
        description: "List all users",
        parameters: [],
      },
      post: {},
    },
  },
});

function makeSemanticRule(semanticId: string): AgentReadinessRule {
  return {
    rule_id: "AB-T001",
    version: "1.0.0",
    name: "Test semantic rule",
    category: "error_semantics",
    severity: "high",
    counted_in_score: true,
    check: {
      type: "semantic_validation",
      sources: ["openapi"],
      semantic: semanticId,
    },
    fix: { eligible: false, type: "none" },
  } as unknown as AgentReadinessRule;
}

function makeSemanticEvidence(
  outcome: SemanticCheckResult["outcome"],
  detail: string,
  snap?: ResponseSnapshot,
): Evidence {
  return {
    type: "http",
    url: snap?.url ?? "https://example.com/openapi.json",
    status: snap?.status ?? 200,
    headers: {},
    content_hash: snap?.bodyHash ?? "abc123",
    content_type: snap?.contentType ?? "application/json",
    resolved_ip: snap?.resolvedIp ?? null,
    captured_at: snap?.fetchedAt ?? "2025-01-01T00:00:00Z",
    semantic_outcome: outcome,
    semantic_detail: detail,
  } as Evidence;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-95-3: Semantic Check Infrastructure", () => {
  describe("parseJsonBody", () => {
    it("parses valid JSON", () => {
      const snap = mockSnap("https://example.com/openapi.json", '{"key":"value"}');
      const result = parseJsonBody(snap);
      expect(result).toEqual({ key: "value" });
    });

    it("returns null for invalid JSON", () => {
      const snap = mockSnap("https://example.com/openapi.json", "not json");
      const result = parseJsonBody(snap);
      expect(result).toBeNull();
    });

    it("returns null for null body", () => {
      const snap = mockSnap("https://example.com/openapi.json", null);
      const result = parseJsonBody(snap);
      expect(result).toBeNull();
    });
  });

  describe("SEMANTIC_CHECKERS registry", () => {
    it("has openapi_operation_descriptions checker", () => {
      expect(SEMANTIC_CHECKERS["openapi_operation_descriptions"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["openapi_operation_descriptions"]).toBe("function");
    });

    it("has openapi_parameter_semantics checker", () => {
      expect(SEMANTIC_CHECKERS["openapi_parameter_semantics"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["openapi_parameter_semantics"]).toBe("function");
    });
  });

  describe("openapi_operation_descriptions checker", () => {
    const checker = SEMANTIC_CHECKERS["openapi_operation_descriptions"];

    it("rich spec with all descriptions → found", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", richOpenApi) };
      const result = checker(sources);
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("descriptions");
    });

    it("bare spec without descriptions → absent", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", bareOpenApi) };
      const result = checker(sources);
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("missing");
    });

    it("partial spec (some descriptions) → partial", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", partialOpenApi) };
      const result = checker(sources);
      expect(result.outcome).toBe("partial");
    });

    it("no openapi snapshot → no_source", () => {
      const sources = { openapi: null };
      const result = checker(sources);
      expect(result.outcome).toBe("no_source");
    });

    it("unparseable body → no_source", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", "not json") };
      const result = checker(sources);
      expect(result.outcome).toBe("no_source");
    });
  });

  describe("openapi_parameter_semantics checker", () => {
    const checker = SEMANTIC_CHECKERS["openapi_parameter_semantics"];

    it("rich spec with parameter descriptions → found", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", richOpenApi) };
      const result = checker(sources);
      expect(result.outcome).toBe("found");
    });

    it("bare spec without parameters → absent", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", bareOpenApi) };
      const result = checker(sources);
      expect(result.outcome).toBe("absent");
    });

    it("no openapi snapshot → no_source", () => {
      const sources = { openapi: null };
      const result = checker(sources);
      expect(result.outcome).toBe("no_source");
    });
  });

  describe("StatusDeterminator — semantic_outcome → status mapping", () => {
    const rule = makeSemanticRule("openapi_operation_descriptions");

    it("found → VERIFIED", () => {
      const evidence = [makeSemanticEvidence("found", "All operations have descriptions")];
      const result = StatusDeterminator.determine({ rule, evidence, isApplicable: true });
      expect(result.status).toBe("VERIFIED");
      expect(result.reason).toContain("descriptions");
    });

    it("partial → INFERRED", () => {
      const evidence = [makeSemanticEvidence("partial", "2 of 3 operations have descriptions")];
      const result = StatusDeterminator.determine({ rule, evidence, isApplicable: true });
      expect(result.status).toBe("INFERRED");
    });

    it("absent → GAP (source present, content absent)", () => {
      const evidence = [makeSemanticEvidence("absent", "No operation descriptions found")];
      const result = StatusDeterminator.determine({ rule, evidence, isApplicable: true });
      expect(result.status).toBe("GAP");
      expect(result.reason).toContain("absent");
    });

    it("no_source → GAP (source not found)", () => {
      const evidence = [makeSemanticEvidence("no_source", "OpenAPI snapshot not found")];
      const result = StatusDeterminator.determine({ rule, evidence, isApplicable: true });
      expect(result.status).toBe("GAP");
      expect(result.reason).toContain("not found");
    });

    it("no evidence → GAP", () => {
      const result = StatusDeterminator.determine({ rule, evidence: [], isApplicable: true });
      expect(result.status).toBe("GAP");
    });
  });

  describe("ConfidenceComputer — semantic outcomes", () => {
    const rule = makeSemanticRule("openapi_operation_descriptions");

    it("VERIFIED with semantic evidence → 0.9 (single source)", () => {
      const evidence = [makeSemanticEvidence("found", "All descriptions present")];
      const confidence = ConfidenceComputer.compute({ rule, evidence, status: "VERIFIED" });
      expect(confidence).toBe(0.9);
    });

    it("INFERRED with partial semantic → 0.5–0.6", () => {
      const evidence = [makeSemanticEvidence("partial", "Some descriptions")];
      const confidence = ConfidenceComputer.compute({ rule, evidence, status: "INFERRED" });
      expect(confidence).toBeGreaterThanOrEqual(0.5);
      expect(confidence).toBeLessThanOrEqual(0.6);
    });

    it("GAP → 0", () => {
      const evidence = [makeSemanticEvidence("absent", "No descriptions")];
      const confidence = ConfidenceComputer.compute({ rule, evidence, status: "GAP" });
      expect(confidence).toBe(0);
    });
  });

  describe("End-to-end pipeline (simulated engine flow)", () => {
    const rule = makeSemanticRule("openapi_operation_descriptions");

    function runPipeline(
      snapshots: Record<string, ResponseSnapshot | null>,
    ): { status: string; confidence: number; evidence: Evidence[]; reason: string } {
      const sources = { openapi: snapshots.openapi };
      const checker = SEMANTIC_CHECKERS[rule.check.semantic!];
      const semanticResult = checker(sources);

      // Always produce evidence — even when source snapshot is null (no_source outcome)
      const snap = snapshots.openapi;
      const evidence: Evidence[] = [{
        type: "http",
        url: snap?.url ?? "",
        status: snap?.status ?? 0,
        headers: {},
        content_hash: snap?.bodyHash ?? "",
        content_type: snap?.contentType ?? null,
        resolved_ip: snap?.resolvedIp ?? null,
        captured_at: snap?.fetchedAt,
        semantic_outcome: semanticResult.outcome,
        semantic_detail: semanticResult.detail,
      } as Evidence];

      const statusResult = StatusDeterminator.determine({
        rule,
        evidence,
        isApplicable: true,
      });
      const confidence = ConfidenceComputer.compute({
        rule,
        evidence,
        status: statusResult.status,
      });

      return {
        status: statusResult.status,
        confidence: confidence ?? 0,
        evidence,
        reason: statusResult.reason,
      };
    }

    it("rich OpenAPI spec → VERIFIED, confidence 0.9", () => {
      const result = runPipeline({
        openapi: mockSnap("https://example.com/openapi.json", richOpenApi),
      });
      expect(result.status).toBe("VERIFIED");
      expect(result.confidence).toBe(0.9);
      expect(result.evidence[0].semantic_outcome).toBe("found");
      expect(result.evidence[0].captured_at).toBe("2025-01-01T00:00:00Z");
    });

    it("bare OpenAPI spec → GAP, confidence 0", () => {
      const result = runPipeline({
        openapi: mockSnap("https://example.com/openapi.json", bareOpenApi),
      });
      expect(result.status).toBe("GAP");
      expect(result.confidence).toBe(0);
      expect(result.evidence[0].semantic_outcome).toBe("absent");
    });

    it("no OpenAPI snapshot → GAP (no_source), confidence 0", () => {
      const result = runPipeline({ openapi: null });
      expect(result.status).toBe("GAP");
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain("not found");
    });

    it("partial OpenAPI spec → INFERRED, confidence 0.5–0.6", () => {
      const result = runPipeline({
        openapi: mockSnap("https://example.com/openapi.json", partialOpenApi),
      });
      expect(result.status).toBe("INFERRED");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.confidence).toBeLessThanOrEqual(0.6);
    });
  });

  describe("Assertion carries EPIC-94 contract fields", () => {
    const rule = makeSemanticRule("openapi_operation_descriptions");

    it("assertion has claim, evidence with captured_at and semantic_outcome", () => {
      const evidence = [makeSemanticEvidence("found", "All descriptions present")];
      const assertion = AssertionBuilder.build({
        rule,
        evidence,
        status: "VERIFIED",
        confidence: 0.9,
        reason: "Direct evidence confirms rule AB-T001",
        sourceUrl: "https://example.com/openapi.json",
      });
      expect(assertion.claim).toBe(rule.name);
      expect(assertion.evidence[0].captured_at).toBe("2025-01-01T00:00:00Z");
      const ev0 = assertion.evidence[0] as Extract<Evidence, { type: "http" }>;
      expect(ev0.semantic_outcome).toBe("found");
      expect(ev0.semantic_detail).toBe("All descriptions present");
    });
  });

  describe("Pure checkers: deterministic (same input → same result)", () => {
    it("openapi_operation_descriptions is deterministic", () => {
      const sources = { openapi: mockSnap("https://example.com/openapi.json", richOpenApi) };
      const r1 = SEMANTIC_CHECKERS["openapi_operation_descriptions"](sources);
      const r2 = SEMANTIC_CHECKERS["openapi_operation_descriptions"](sources);
      expect(r1).toEqual(r2);
    });
  });
});
