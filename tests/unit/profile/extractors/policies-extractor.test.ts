import { describe, it, expect } from "vitest";
import { extractPolicies } from "../../../../src/agent-readiness/profile/extractors/policies-extractor";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"]; evidence?: Evidence[] }): Assertion {
  return {
    rule_id: overrides.rule_id, rule_version: "2.4.0", status: overrides.status,
    evidence: overrides.evidence ?? [], confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? "2026-09-01T10:00:00Z", source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok", category: overrides.category, name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim", verified_at: overrides.verified_at ?? "2026-09-01T10:00:00Z",
    review_level: "automatic",
  };
}

function makeHttpEvidence(url: string, detail?: string): Evidence {
  return { type: "http", url, status: 200, headers: {}, content_hash: "x",
    content_type: "application/json", resolved_ip: null,
    source_class: "machine_readable_spec", semantic_detail: detail } as Evidence;
}

function makeRobotsEvidence(allowsAll: boolean, disallowed: string[]): Evidence {
  return { type: "robots", url: "https://api.example.com/robots.txt", status: 200,
    allows_all: allowsAll, disallowed_paths: disallowed, source_class: "website_content" } as Evidence;
}

describe("SLICE-101-5: extractPolicies — llm_policy", () => {
  it("extracts LLM policy summary from llm-policy.json", () => {
    const a = [makeAssertion({ rule_id: "AB-001", category: "agent_policy", status: "VERIFIED",
      evidence: [makeHttpEvidence("https://api.example.com/llm-policy.json", JSON.stringify({ summary: "Allowed with attribution" }))] })];
    expect(extractPolicies(a)!.data.llm_policy).toBe("Allowed with attribution");
  });

  it("extracts LLM policy from structured permissions", () => {
    const detail = JSON.stringify({ pre_training: "denied", fine_tuning: "denied", rag: "allowed", agentic: "allowed" });
    const a = [makeAssertion({ rule_id: "AB-001", category: "agent_policy", status: "VERIFIED",
      evidence: [makeHttpEvidence("https://api.example.com/llm-policy.json", detail)] })];
    const policy = extractPolicies(a)!.data.llm_policy!;
    expect(policy).toContain("pre-training: denied");
    expect(policy).toContain("RAG: allowed");
    expect(policy).toContain("agentic: allowed");
  });
});

describe("SLICE-101-5: extractPolicies — agents_txt + robots_txt", () => {
  it("sets agents_txt true from VERIFIED agents_txt assertion", () => {
    const a = [makeAssertion({ rule_id: "AB-003", category: "agents_txt", status: "VERIFIED",
      name: "agents.txt", evidence: [makeHttpEvidence("https://api.example.com/agents.txt")] })];
    expect(extractPolicies(a)!.data.agents_txt).toBe(true);
  });

  it("sets robots_txt true from VERIFIED assertion with robots evidence", () => {
    const a = [makeAssertion({ rule_id: "AB-002", category: "agent_policy", status: "VERIFIED",
      name: "robots.txt", evidence: [makeRobotsEvidence(true, [])] })];
    expect(extractPolicies(a)!.data.robots_txt).toBe(true);
  });

  it("agents_txt and robots_txt false when not VERIFIED", () => {
    const a = [makeAssertion({ rule_id: "AB-001", category: "agent_policy", status: "VERIFIED",
      evidence: [makeHttpEvidence("https://api.example.com/llm-policy.json", JSON.stringify({ summary: "ok" }))] })];
    const p = extractPolicies(a)!.data;
    expect(p.agents_txt).toBe(false);
    expect(p.robots_txt).toBe(false);
  });
});

describe("SLICE-101-5: extractPolicies — crawling", () => {
  it("crawling 'allowed' when robots allows all", () => {
    const a = [makeAssertion({ rule_id: "AB-002", category: "agent_policy", status: "VERIFIED",
      evidence: [makeRobotsEvidence(true, [])] })];
    expect(extractPolicies(a)!.data.crawling).toBe("allowed");
  });

  it("crawling 'restricted' when robots has partial disallow", () => {
    const a = [makeAssertion({ rule_id: "AB-002", category: "agent_policy", status: "VERIFIED",
      evidence: [makeRobotsEvidence(false, ["/admin", "/private"])] })];
    expect(extractPolicies(a)!.data.crawling).toBe("restricted");
  });

  it("crawling 'denied' when robots disallows all", () => {
    const a = [makeAssertion({ rule_id: "AB-002", category: "agent_policy", status: "VERIFIED",
      evidence: [makeRobotsEvidence(false, ["/"])] })];
    expect(extractPolicies(a)!.data.crawling).toBe("denied");
  });
});

describe("SLICE-101-5: extractPolicies — section meta + edge cases", () => {
  it("computes confidence as mean", () => {
    const a = [
      makeAssertion({ rule_id: "AB-001", category: "agent_policy", status: "VERIFIED", confidence: 0.9, evidence: [makeHttpEvidence("https://x.com/llm-policy.json", JSON.stringify({ summary: "ok" }))] }),
      makeAssertion({ rule_id: "AB-003", category: "agents_txt", status: "VERIFIED", confidence: 0.8, evidence: [makeHttpEvidence("https://x.com/agents.txt")] }),
    ];
    expect(extractPolicies(a)!.confidence).toBeCloseTo(0.85, 5);
  });

  it("gaps contains GAP rule_ids", () => {
    const a = [
      makeAssertion({ rule_id: "AB-001", category: "agent_policy", status: "VERIFIED", evidence: [makeHttpEvidence("https://x.com/llm-policy.json", JSON.stringify({ summary: "ok" }))] }),
      makeAssertion({ rule_id: "AB-004", category: "agent_policy", status: "GAP", confidence: 0 }),
    ];
    expect(extractPolicies(a)!.gaps).toContain("AB-004");
  });

  it("returns undefined when zero applicable", () => {
    expect(extractPolicies([makeAssertion({ rule_id: "AB-030", category: "pricing", status: "VERIFIED" })])).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(extractPolicies([])).toBeUndefined();
  });
});
