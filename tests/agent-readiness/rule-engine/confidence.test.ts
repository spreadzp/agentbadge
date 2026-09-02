import { describe, it, expect } from "vitest";
import { ConfidenceComputer } from "../../../src/agent-readiness/rule-engine/confidence";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

const mockRule = (): AgentReadinessRule => ({
  rule_id: "AB-001",
  version: "1.0.0",
  name: "robots.txt present",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: { type: "http_fetch", target: "/robots.txt" },
  fix: { eligible: true, type: "deterministic", note: "Scaffold" },
});

const httpEv: Evidence = { type: "http", url: "https://a.com", status: 200, headers: {}, content_hash: "a", content_type: "text/plain", resolved_ip: "1.2.3.4" };
const openApiEv: Evidence = { type: "openapi", url: "https://a.com/openapi.json", paths: ["/api"], methods: ["GET"] };
const robotsEv: Evidence = { type: "robots", url: "https://a.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] };
const crossEv: Evidence = { type: "cross", sources: [], match_keys: [], conflict_reason: "test" };

describe("ConfidenceComputer", () => {
  it("returns null for NOT_APPLICABLE", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [],
      status: "NOT_APPLICABLE",
    });
    expect(result).toBeNull();
  });

  it("returns 0.0 for GAP", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [],
      status: "GAP",
    });
    expect(result).toBe(0.0);
  });

  it("returns 0.9 for VERIFIED with 1 evidence source", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [httpEv],
      status: "VERIFIED",
    });
    expect(result).toBe(0.9);
  });

  it("returns 0.95 for VERIFIED with 2 evidence sources", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [httpEv, robotsEv],
      status: "VERIFIED",
    });
    expect(result).toBe(0.95);
  });

  it("returns 1.0 for VERIFIED with 3+ evidence sources", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [httpEv, robotsEv, openApiEv],
      status: "VERIFIED",
    });
    expect(result).toBe(1.0);
  });

  it("returns 0.5 for INFERRED with 1 evidence source", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [openApiEv],
      status: "INFERRED",
    });
    expect(result).toBe(0.5);
  });

  it("returns 0.6 for INFERRED with 2 evidence sources", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [openApiEv, httpEv],
      status: "INFERRED",
    });
    expect(result).toBe(0.6);
  });

  it("returns 0.7 for INFERRED with 3+ evidence sources", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [openApiEv, httpEv, robotsEv],
      status: "INFERRED",
    });
    expect(result).toBe(0.7);
  });

  it("returns 0.0 for CONFLICT with 2 sources", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [httpEv, crossEv],
      status: "CONFLICT",
    });
    expect(result).toBe(0.0);
  });

  it("returns 0.3 for CONFLICT with 3+ sources and cross evidence", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [httpEv, robotsEv, crossEv],
      status: "CONFLICT",
    });
    expect(result).toBe(0.3);
  });

  it("INFERRED confidence is ≤ 0.7 (never higher)", () => {
    const manyEvidence: Evidence[] = Array(10).fill(openApiEv);
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: manyEvidence,
      status: "INFERRED",
    });
    expect(result!).toBeLessThanOrEqual(0.7);
  });

  it("VERIFIED confidence is ≥ 0.9 (never lower)", () => {
    const result = ConfidenceComputer.compute({
      rule: mockRule(),
      evidence: [httpEv],
      status: "VERIFIED",
    });
    expect(result!).toBeGreaterThanOrEqual(0.9);
  });
});
