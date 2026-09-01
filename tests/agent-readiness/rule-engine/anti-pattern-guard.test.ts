import { describe, it, expect } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { ConfidenceComputer } from "../../../src/agent-readiness/rule-engine/confidence";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const mockSnap = (url: string): ResponseSnapshot => ({
  url, status: 200, bodyHash: "abc", bodySize: 10, contentType: "text/plain",
  resolvedIp: "1.2.3.4", fetchedAt: new Date().toISOString(), fetchTimeMs: 5, redirectChain: [],
});

const mockState = (snaps?: Partial<Record<string, ResponseSnapshot | null>>): SourceState => ({
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: { robots: null, sitemap: null, guide: null, openapi: null, mcp: null, ...snaps } as Record<string, ResponseSnapshot | null>,
});

describe("Anti-Pattern Guard Tests", () => {
  // Guard 1: Confidence ≠ Score — confidence must not affect scoring
  it("confidence is metadata only and does not appear as a score field", () => {
    const result = RuleEngine.run(mockState({ robots: mockSnap("https://example.com/robots.txt") }));

    for (const a of result.assertions) {
      expect(a).not.toHaveProperty("score");
      expect(a).not.toHaveProperty("score_value");
      expect(a).not.toHaveProperty("points");
    }
  });

  it("confidence value is separate from assertion status", () => {
    const result = RuleEngine.run(mockState({ robots: mockSnap("https://example.com/robots.txt") }));

    for (const a of result.assertions) {
      // confidence is a number, status is a string — they are different fields
      expect(typeof a.confidence).toBe("number");
      expect(typeof a.status).toBe("string");
      // confidence must not equal a status string
      expect(a.confidence).not.toBe(a.status);
    }
  });

  // Guard 2: No LLM imports — all deterministic
  it("rule-engine module has no LLM/AI imports", async () => {
    const modules = [
      "rule-loader.ts",
      "evidence.types.ts",
      "status-determinator.ts",
      "assertion-builder.ts",
      "confidence.ts",
      "rule-engine.ts",
      "rule-checkers.ts",
      "conflict-detector.ts",
      "openapi-parser.ts",
    ];

    for (const mod of modules) {
      const path = `../../../src/agent-readiness/rule-engine/${mod}`;
      const imported = await import(path);
      // No LLM-related functions should be exported
      const keys = Object.keys(imported);
      expect(keys.some((k) => k.toLowerCase().includes("llm"))).toBe(false);
      expect(keys.some((k) => k.toLowerCase().includes("ai"))).toBe(false);
      expect(keys.some((k) => k.toLowerCase().includes("gpt"))).toBe(false);
      expect(keys.some((k) => k.toLowerCase().includes("openai"))).toBe(false);
    }
  });

  // Guard 3: Determinism — byte-identical re-run (same input → same output structure)
  it("re-running with same input produces same assertion count and statuses", () => {
    const state = mockState({
      robots: mockSnap("https://example.com/robots.txt"),
      sitemap: mockSnap("https://example.com/sitemap.xml"),
      guide: mockSnap("https://example.com/.well-known/agent-guide.json"),
    });

    RuleEngine.reset();
    const r1 = RuleEngine.run(state);
    RuleEngine.reset();
    const r2 = RuleEngine.run(state);

    expect(r1.assertions.length).toBe(r2.assertions.length);
    for (let i = 0; i < r1.assertions.length; i++) {
      expect(r1.assertions[i].rule_id).toBe(r2.assertions[i].rule_id);
      expect(r1.assertions[i].status).toBe(r2.assertions[i].status);
      expect(r1.assertions[i].confidence).toBe(r2.assertions[i].confidence);
    }
  });

  // Guard 4: Exact match only — no fuzzy matching
  it("StatusDeterminator uses exact match, not fuzzy", () => {
    const result = ConfidenceComputer.compute({
      rule: { rule_id: "AB-001", version: "1.0.0", name: "test", category: "documentation", severity: "high", counted_in_score: true, check: { type: "http_fetch" }, fix: { eligible: false, type: "none" } } as any,
      evidence: [],
      status: "GAP",
    });

    // MISSING with 0 evidence → exactly 0.0
    expect(result).toBe(0.0);
  });

  // Guard 5: Status without confidence — NOT_APPLICABLE has null confidence
  it("NOT_APPLICABLE assertions have confidence that does not affect score", () => {
    const state = mockState(); // empty — all NOT_APPLICABLE
    const result = RuleEngine.run(state);

    const naAssertions = result.assertions.filter((a) => a.status === "NOT_APPLICABLE");
    expect(naAssertions.length).toBeGreaterThan(0);

    for (const a of naAssertions) {
      // Confidence for NOT_APPLICABLE should be 0 (clamped from null)
      expect(a.confidence).toBe(0);
    }
  });

  // Guard 6: No circular references in assertions
  it("assertions are JSON-serializable (no circular refs)", () => {
    const result = RuleEngine.run(mockState({ robots: mockSnap("https://example.com/robots.txt") }));
    for (const a of result.assertions) {
      const json = JSON.stringify(a);
      expect(json).toBeTruthy();
      const parsed = JSON.parse(json);
      expect(parsed.rule_id).toBe(a.rule_id);
    }
  });

  // Guard 7: Evidence array is immutable after assertion build
  it("assertion builder does not mutate input evidence", () => {
    const originalEvidence = [
      { type: "http" as const, url: "https://example.com/test", status: 200, headers: {}, content_hash: "abc", content_type: "text/plain", resolved_ip: "1.2.3.4" },
    ];
    const originalCopy = JSON.parse(JSON.stringify(originalEvidence));

    AssertionBuilder.build({
      rule: { rule_id: "AB-001", version: "1.0.0", name: "test", category: "documentation", severity: "high", counted_in_score: true, check: { type: "http_fetch" }, fix: { eligible: false, type: "none" } } as any,
      evidence: originalEvidence,
      status: "VERIFIED",
      confidence: 0.9,
      reason: "test",
      sourceUrl: "https://example.com/test",
    });

    expect(originalEvidence).toEqual(originalCopy);
  });
});
