import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runTask } from "../../../src/agent-readiness/runtime/executor";
import { compareDeclaredVsObserved, type DeclaredFact, type ObservedFact } from "../../../src/agent-readiness/runtime/comparison";
import { RT03_AUTH } from "../../../src/agent-readiness/runtime/tasks/rt03-auth";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { deriveGaps } from "../../../src/agent-readiness/gap-engine/gap-engine";

describe("SLICE-98-5: Declared vs Observed comparison engine", () => {
  describe("Rule 1: Auth scheme mismatch", () => {
    it("CONFLICT when declared OAuth2 but observed API-key (401 with WWW-Authenticate: ApiKey)", () => {
      const declared: DeclaredFact = {
        family: "auth_scheme",
        rule_id: "AB-007",
        value: "oauth2",
        claim: "Auth scheme is OAuth2",
      };
      const observed: ObservedFact = {
        family: "auth_scheme",
        task_id: "RT-03",
        step_seq: 2,
        observed_value: "api_key",
        observed_detail: "401 with WWW-Authenticate: ApiKey",
        response_ref: "snap:abc123",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("CONFLICT");
      expect(results[0].assertion.rule_id).toBe("AB-007");
      expect(results[0].assertion.confidence).toBeGreaterThanOrEqual(0.9);
      expect(results[0].assertion.evidence).toHaveLength(1);
      expect(results[0].assertion.evidence[0].source).toBe("runtime");
    });

    it("No assertion when auth schemes match", () => {
      const declared: DeclaredFact = {
        family: "auth_scheme",
        rule_id: "AB-007",
        value: "api_key",
        claim: "Auth scheme is API-key",
      };
      const observed: ObservedFact = {
        family: "auth_scheme",
        task_id: "RT-03",
        step_seq: 2,
        observed_value: "api_key",
        observed_detail: "401 with WWW-Authenticate: ApiKey",
        response_ref: "snap:abc123",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(0);
    });
  });

  describe("Rule 2: Response schema mismatch", () => {
    it("CONFLICT when declared schema differs from observed body structure", () => {
      const declared: DeclaredFact = {
        family: "response_schema",
        rule_id: "AB-020",
        value: "{ status: string, data: object }",
        claim: "Response schema has status and data fields",
      };
      const observed: ObservedFact = {
        family: "response_schema",
        task_id: "RT-02",
        step_seq: 1,
        observed_value: "{ error: string }",
        observed_detail: "Response body has error field, missing status and data",
        response_ref: "snap:def456",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("CONFLICT");
      expect(results[0].assertion.rule_id).toBe("AB-020");
    });

    it("No assertion when schemas match", () => {
      const declared: DeclaredFact = {
        family: "response_schema",
        rule_id: "AB-020",
        value: "{ status: string }",
        claim: "Response schema has status field",
      };
      const observed: ObservedFact = {
        family: "response_schema",
        task_id: "RT-02",
        step_seq: 1,
        observed_value: "{ status: string }",
        observed_detail: "Response body matches",
        response_ref: "snap:def456",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(0);
    });
  });

  describe("Rule 3: Error semantics mismatch", () => {
    it("CONFLICT when declared 429 with Retry-After but observed without", () => {
      const declared: DeclaredFact = {
        family: "error_semantics",
        rule_id: "AB-030",
        value: "429 with Retry-After header",
        claim: "429 responses include Retry-After header",
      };
      const observed: ObservedFact = {
        family: "error_semantics",
        task_id: "RT-07",
        step_seq: 1,
        observed_value: "429 without Retry-After",
        observed_detail: "429 response missing Retry-After header",
        response_ref: "snap:ghi789",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("CONFLICT");
    });
  });

  describe("Rule 4: Rate-limit header contradiction", () => {
    it("CONFLICT when declared limits differ from observed headers", () => {
      const declared: DeclaredFact = {
        family: "rate_limits",
        rule_id: "AB-151",
        value: "X-RateLimit-Limit: 100, X-RateLimit-Remaining: 50",
        claim: "Rate limits are 100/50",
      };
      const observed: ObservedFact = {
        family: "rate_limits",
        task_id: "RT-07",
        step_seq: 1,
        observed_value: "X-RateLimit-Limit: 1000, X-RateLimit-Remaining: 999",
        observed_detail: "Observed rate limits are 1000/999",
        response_ref: "snap:jkl012",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("CONFLICT");
      expect(results[0].assertion.rule_id).toBe("AB-151");
    });

    it("No false CONFLICT when rate-limit headers are absent (noise guard)", () => {
      const declared: DeclaredFact = {
        family: "rate_limits",
        rule_id: "AB-151",
        value: "X-RateLimit-Limit: 100",
        claim: "Rate limit is 100",
      };
      const observed: ObservedFact = {
        family: "rate_limits",
        task_id: "RT-07",
        step_seq: 1,
        observed_value: "",
        observed_detail: "No rate-limit headers observed",
        response_ref: "snap:jkl012",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(0);
    });
  });

  describe("Rule 5: Versioning contradiction", () => {
    it("CONFLICT when declared /v1/ but observed Sunset header", () => {
      const declared: DeclaredFact = {
        family: "versioning",
        rule_id: "AB-040",
        value: "/v1/ path prefix, no Sunset",
        claim: "API uses /v1/ path prefix without deprecation",
      };
      const observed: ObservedFact = {
        family: "versioning",
        task_id: "RT-08",
        step_seq: 1,
        observed_value: "Sunset: Sat, 25 Dec 2025 00:00:00 GMT",
        observed_detail: "Sunset header present on /v1/ endpoint",
        response_ref: "snap:mno345",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("CONFLICT");
    });
  });

  describe("Failed step with no declaration → GAP", () => {
    it("GAP assertion when runtime step fails and no static assertion covers it", () => {
      const observed: ObservedFact = {
        family: "undeclared_failure",
        task_id: "RT-01",
        step_seq: 2,
        observed_value: "404",
        observed_detail: "Endpoint /agents.txt returned 404, no static assertion declared it",
        response_ref: "snap:pqr678",
      };

      const results = compareDeclaredVsObserved([], [observed]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("GAP");
      expect(results[0].assertion.confidence).toBeGreaterThanOrEqual(0.9);
      expect(results[0].assertion.evidence[0].source).toBe("runtime");
    });
  });

  describe("Determinism + idempotence", () => {
    it("same inputs → same outputs (stable ordering)", () => {
      const declared: DeclaredFact[] = [
        { family: "auth_scheme", rule_id: "AB-007", value: "oauth2", claim: "OAuth2" },
        { family: "rate_limits", rule_id: "AB-151", value: "100/50", claim: "100/50" },
      ];
      const observed: ObservedFact[] = [
        { family: "auth_scheme", task_id: "RT-03", step_seq: 2, observed_value: "api_key", observed_detail: "ApiKey", response_ref: "snap:a" },
        { family: "rate_limits", task_id: "RT-07", step_seq: 1, observed_value: "1000/999", observed_detail: "1000/999", response_ref: "snap:b" },
      ];

      const r1 = compareDeclaredVsObserved(declared, observed);
      const r2 = compareDeclaredVsObserved(declared, observed);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
      // Stable ordering by rule family
      expect(r1[0].assertion.rule_id).toBe("AB-007");
      expect(r1[1].assertion.rule_id).toBe("AB-151");
    });
  });

  describe("RuntimeEvidence properties", () => {
    it("all comparison assertions have source_class runtime and confidence ≥ 0.9", () => {
      const declared: DeclaredFact = {
        family: "auth_scheme",
        rule_id: "AB-007",
        value: "oauth2",
        claim: "OAuth2",
      };
      const observed: ObservedFact = {
        family: "auth_scheme",
        task_id: "RT-03",
        step_seq: 2,
        observed_value: "api_key",
        observed_detail: "ApiKey",
        response_ref: "snap:a",
      };

      const results = compareDeclaredVsObserved([declared], [observed]);
      expect(results[0].assertion.evidence[0].source).toBe("runtime");
      expect(results[0].assertion.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });
});

describe("SLICE-98-5: Integration — comparison → 96 gap engine", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0, scenarios: { authMismatch: true, rateLimitMismatch: true } });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("full chain: runTask → observedFacts → compare → assertions → deriveGaps → runtime-proven gap", async () => {
    // Run RT-03 (auth task) against fixture with auth mismatch
    const trace = await runTask(RT03_AUTH, baseUrl, {});

    // Extract observed facts from trace
    const observed: ObservedFact[] = [];
    for (const step of trace.steps) {
      if (step.phase === "auth" && step.outcome === "stopped") {
        observed.push({
          family: "auth_scheme",
          task_id: trace.task_id,
          step_seq: step.seq,
          observed_value: "api_key",
          observed_detail: step.notes ?? "auth blocked",
          response_ref: step.response_ref ?? "",
        });
      }
    }

    // Declared fact: OAuth2 (from fixture server's OpenAPI)
    const declared: DeclaredFact = {
      family: "auth_scheme",
      rule_id: "AB-007",
      value: "oauth2",
      claim: "Auth scheme is OAuth2",
    };

    const results = compareDeclaredVsObserved([declared], observed);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("CONFLICT");

    // Convert to Assertion[] and feed to 96 gap engine
    const assertions: Assertion[] = results.map((r) => r.assertion);
    const gaps = deriveGaps(assertions, []);

    // Should produce at least one evidence gap
    expect(gaps.length).toBeGreaterThan(0);
    const evidenceGap = gaps.find((g) => g.type === "evidence");
    expect(evidenceGap).toBeDefined();
    expect(evidenceGap!.related_rules).toContain("AB-007");
  });

  it("mismatch OFF → no CONFLICT → no gap", async () => {
    const server2 = createRuntimeTargetServer({
      port: 0,
      scenarios: { authMismatch: false, rateLimitMismatch: false },
    });
    const url2 = await server2.start();
    try {
      const trace = await runTask(RT03_AUTH, url2, { credentials: { "X-Api-Key": "test-key" } });
      // With auth mismatch OFF and creds provided, should succeed
      expect(trace.outcome).toBe("success");

      // No observed auth mismatch
      const observed: ObservedFact[] = [];
      const declared: DeclaredFact = {
        family: "auth_scheme",
        rule_id: "AB-007",
        value: "api_key",
        claim: "Auth scheme is API-key",
      };

      const results = compareDeclaredVsObserved([declared], observed);
      expect(results).toHaveLength(0);
    } finally {
      await server2.stop();
    }
  });
});
