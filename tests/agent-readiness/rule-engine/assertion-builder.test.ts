import { describe, it, expect } from "vitest";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

const mockRule = (overrides?: Partial<AgentReadinessRule>): AgentReadinessRule => ({
  rule_id: "AB-001",
  version: "1.0.0",
  name: "robots.txt present",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: { type: "http_fetch", target: "/robots.txt" },
  fix: { eligible: true, type: "deterministic", note: "Scaffold default" },
  ...overrides,
});

const httpEvidence: Evidence = {
  type: "http",
  url: "https://example.com/robots.txt",
  status: 200,
  headers: { "content-type": "text/plain" },
  content_hash: "abc123",
  content_type: "text/plain",
  resolved_ip: "93.184.216.34",
};

describe("AssertionBuilder", () => {
  it("builds a VERIFIED assertion with all fields", () => {
    const rule = mockRule();
    const assertion = AssertionBuilder.build({
      rule,
      evidence: [httpEvidence],
      status: "VERIFIED",
      confidence: 0.95,
      reason: "robots.txt found and accessible",
      sourceUrl: "https://example.com/robots.txt",
    });

    expect(assertion.rule_id).toBe("AB-001");
    expect(assertion.rule_version).toBe("1.0.0");
    expect(assertion.status).toBe("VERIFIED");
    expect(assertion.evidence).toHaveLength(1);
    expect(assertion.evidence[0]).toEqual(httpEvidence);
    expect(assertion.confidence).toBe(0.95);
    expect(assertion.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(assertion.source_url).toBe("https://example.com/robots.txt");
    expect(assertion.reason).toBe("robots.txt found and accessible");
  });

  it("builds a GAP assertion with empty evidence", () => {
    const assertion = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [],
      status: "GAP",
      confidence: 0,
      reason: "No evidence found",
    });

    expect(assertion.status).toBe("GAP");
    expect(assertion.evidence).toEqual([]);
    expect(assertion.confidence).toBe(0);
    expect(assertion.source_url).toBeNull();
  });

  it("builds a NOT_APPLICABLE assertion", () => {
    const assertion = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [],
      status: "NOT_APPLICABLE",
      confidence: 0,
      reason: "Rule does not apply to this source type",
    });

    expect(assertion.status).toBe("NOT_APPLICABLE");
    expect(assertion.reason).toContain("does not apply");
  });

  it("clamps confidence to [0, 1]", () => {
    const high = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [],
      status: "VERIFIED",
      confidence: 1.5,
      reason: "test",
    });
    expect(high.confidence).toBe(1);

    const low = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [],
      status: "GAP",
      confidence: -0.5,
      reason: "test",
    });
    expect(low.confidence).toBe(0);
  });

  it("preserves evidence order", () => {
    const ev1: Evidence = { type: "http", url: "https://a.com/1", status: 200, headers: {}, content_hash: "a", content_type: null, resolved_ip: null };
    const ev2: Evidence = { type: "http", url: "https://b.com/2", status: 200, headers: {}, content_hash: "b", content_type: null, resolved_ip: null };
    const ev3: Evidence = { type: "openapi", url: "https://c.com/3", paths: ["/api"], methods: ["GET"] };

    const assertion = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [ev1, ev2, ev3],
      status: "VERIFIED",
      confidence: 0.8,
      reason: "Multiple evidence",
    });

    expect(assertion.evidence[0]).toEqual(ev1);
    expect(assertion.evidence[1]).toEqual(ev2);
    expect(assertion.evidence[2]).toEqual(ev3);
  });

  it("serializes to valid JSON and deserializes back", () => {
    const assertion = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [httpEvidence],
      status: "VERIFIED",
      confidence: 0.9,
      reason: "test serialization",
      sourceUrl: "https://example.com",
    });

    const json = AssertionBuilder.serialize(assertion);
    const parsed = AssertionBuilder.deserialize(json);

    expect(parsed.rule_id).toBe(assertion.rule_id);
    expect(parsed.status).toBe(assertion.status);
    expect(parsed.confidence).toBe(assertion.confidence);
    expect(parsed.evidence).toEqual(assertion.evidence);
    expect(parsed.timestamp).toBe(assertion.timestamp);
    expect(parsed.source_url).toBe(assertion.source_url);
    expect(parsed.reason).toBe(assertion.reason);
  });

  it("serializes without functions or circular refs", () => {
    const assertion = AssertionBuilder.build({
      rule: mockRule(),
      evidence: [httpEvidence],
      status: "VERIFIED",
      confidence: 1,
      reason: "test",
    });

    const json = AssertionBuilder.serialize(assertion);
    const obj = JSON.parse(json);

    expect(typeof obj).toBe("object");
    expect(obj).not.toHaveProperty("undefined");
    for (const value of Object.values(obj)) {
      expect(typeof value).not.toBe("function");
    }
  });

  it("copies evidence array (does not mutate original)", () => {
    const originalEvidence: Evidence[] = [httpEvidence];
    const assertion = AssertionBuilder.build({
      rule: mockRule(),
      evidence: originalEvidence,
      status: "VERIFIED",
      confidence: 1,
      reason: "test",
    });

    assertion.evidence.push({ type: "openapi", url: "", paths: [], methods: [] });
    expect(originalEvidence).toHaveLength(1);
  });
});
