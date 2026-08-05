import { describe, it, expect, beforeAll } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { RULE_CHECKERS } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const mockSnap = (url: string, status = 200): ResponseSnapshot => ({
  url,
  status,
  bodyHash: "abc123",
  bodySize: 100,
  contentType: "application/json",
  resolvedIp: "93.184.216.34",
  fetchedAt: new Date().toISOString(),
  fetchTimeMs: 50,
  redirectChain: [],
});

const fullSourceState: SourceState = {
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: {
    robots: mockSnap("https://example.com/robots.txt"),
    sitemap: mockSnap("https://example.com/sitemap.xml"),
    guide: mockSnap("https://example.com/.well-known/agent-guide.json"),
    openapi: mockSnap("https://example.com/openapi.json"),
    mcp: mockSnap("https://example.com/.well-known/mcp.json"),
  } as Record<string, ResponseSnapshot | null>,
};

const emptySourceState: SourceState = {
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: {} as Record<string, ResponseSnapshot | null>,
};

describe("Rule Engine Integration — All 13 Rules", () => {
  beforeAll(() => {
    RuleEngine.reset();
  });

  it("produces 13 assertions for full SourceState", () => {
    const result = RuleEngine.run(fullSourceState);
    expect(result.assertions).toHaveLength(13);
  });

  it("all resource-based rules are VERIFIED with full SourceState", () => {
    const result = RuleEngine.run(fullSourceState);
    const verified = result.assertions.filter((a) => a.status === "VERIFIED");
    expect(verified.length).toBeGreaterThanOrEqual(4);
  });

  it("all assertions have valid rule_ids matching AB-001..AB-013", () => {
    const result = RuleEngine.run(fullSourceState);
    const validIds = new Set([
      "AB-001", "AB-002", "AB-003", "AB-004", "AB-005", "AB-006",
      "AB-007", "AB-008", "AB-009", "AB-010", "AB-011", "AB-012", "AB-013",
    ]);
    for (const a of result.assertions) {
      expect(validIds.has(a.rule_id)).toBe(true);
    }
  });

  it("assertions are sorted by rule_id alphabetically", () => {
    const result = RuleEngine.run(fullSourceState);
    const ids = result.assertions.map((a) => a.rule_id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("empty SourceState produces all NOT_APPLICABLE or MISSING", () => {
    const result = RuleEngine.run(emptySourceState);
    const naOrMissing = result.assertions.filter(
      (a) => a.status === "NOT_APPLICABLE" || a.status === "MISSING",
    );
    expect(naOrMissing.length).toBe(13);
  });

  it("every checker in RULE_CHECKERS produces evidence for full SourceState", () => {
    for (const [ruleId, checker] of Object.entries(RULE_CHECKERS)) {
      const evidence = checker(fullSourceState);
      expect(evidence.length, `${ruleId} should produce evidence`).toBeGreaterThan(0);
    }
  });

  it("result includes metadata (rulesetVersion, scannedAt, counts)", () => {
    const result = RuleEngine.run(fullSourceState);
    expect(result.rulesetVersion).toBeTruthy();
    expect(result.scannedAt).toMatch(/^\d{4}-/);
    expect(result.totalRules).toBe(13);
    expect(result.applicableRules).toBeGreaterThan(0);
    expect(result.applicableRules).toBeLessThanOrEqual(13);
  });

  it("every assertion is JSON-serializable (no circular refs)", () => {
    const result = RuleEngine.run(fullSourceState);
    for (const a of result.assertions) {
      expect(() => JSON.stringify(a)).not.toThrow();
    }
  });

  it("confidence is null or 0..1 for every assertion", () => {
    const result = RuleEngine.run(fullSourceState);
    for (const a of result.assertions) {
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("re-running produces same assertion count (determinism)", () => {
    const r1 = RuleEngine.run(fullSourceState);
    RuleEngine.reset();
    const r2 = RuleEngine.run(fullSourceState);
    expect(r1.assertions.length).toBe(r2.assertions.length);
    expect(r1.totalRules).toBe(r2.totalRules);
  });
});
