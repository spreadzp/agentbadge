import { describe, it, expect } from "vitest";
import { extractLimits } from "../../../../src/agent-readiness/profile/extractors/limits-extractor";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"]; evidence?: Evidence[] }): Assertion {
  return {
    rule_id: overrides.rule_id, rule_version: "2.4.0", status: overrides.status,
    evidence: overrides.evidence ?? [], confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? "2026-09-01T10:00:00Z", source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok", category: overrides.category, name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim", verified_at: overrides.verified_at ?? "2026-09-01T10:00:00Z",
    review_level: "auto" as any,
  };
}

function makeHttpEvidence(url: string, detail?: string, headers?: Record<string, string>): Evidence {
  return { type: "http", url, status: 200, headers: headers ?? {}, content_hash: "x",
    content_type: "application/json", resolved_ip: null, source_class: "machine_readable_spec",
    semantic_detail: detail } as Evidence;
}

function makeRobotsEvidence(allowsAll: boolean, disallowed: string[], detail?: string): Evidence {
  return { type: "robots", url: "https://api.example.com/robots.txt", status: 200,
    allows_all: allowsAll, disallowed_paths: disallowed, source_class: "website_content",
    semantic_detail: detail } as Evidence;
}

describe("SLICE-101-5: extractLimits — rate_limit", () => {
  it("extracts rate limit from x-ratelimit-limit header", () => {
    const a = [makeAssertion({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED",
      evidence: [makeHttpEvidence("https://x.com", undefined, { "x-ratelimit-limit": "100" })] })];
    expect(extractLimits(a)!.data.rate_limit).toBe("100 req/period");
  });

  it("extracts rate limit from semantic_detail JSON", () => {
    const a = [makeAssertion({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED",
      evidence: [makeHttpEvidence("https://x.com", JSON.stringify({ rate_limit: "100 req/min" }))] })];
    expect(extractLimits(a)!.data.rate_limit).toBe("100 req/min");
  });

  it("extracts crawl-delay from robots.txt", () => {
    const a = [makeAssertion({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED",
      evidence: [makeRobotsEvidence(true, [], "User-agent: *\nCrawl-delay: 10")] })];
    expect(extractLimits(a)!.data.rate_limit).toContain("crawl-delay 10");
  });

  it("extracts concurrent from detail JSON", () => {
    const a = [makeAssertion({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED",
      evidence: [makeHttpEvidence("https://x.com", JSON.stringify({ concurrent: 10 }))] })];
    expect(extractLimits(a)!.data.concurrent).toBe(10);
  });
});

describe("SLICE-101-5: extractLimits — section meta + edge cases", () => {
  it("computes confidence as mean", () => {
    const a = [
      makeAssertion({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED", confidence: 0.8, evidence: [makeHttpEvidence("https://x.com", JSON.stringify({ rate_limit: "100/min" }))] }),
      makeAssertion({ rule_id: "AB-012", category: "rate_limits", status: "VERIFIED", confidence: 0.9, evidence: [makeHttpEvidence("https://y.com")] }),
    ];
    expect(extractLimits(a)!.confidence).toBeCloseTo(0.85, 5);
  });

  it("gaps contains GAP rule_ids", () => {
    const a = [
      makeAssertion({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED", evidence: [makeHttpEvidence("https://x.com")] }),
      makeAssertion({ rule_id: "AB-012", category: "rate_limits", status: "GAP", confidence: 0 }),
    ];
    expect(extractLimits(a)!.gaps).toContain("AB-012");
  });

  it("returns undefined when zero applicable", () => {
    expect(extractLimits([makeAssertion({ rule_id: "AB-030", category: "pricing", status: "VERIFIED" })])).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(extractLimits([])).toBeUndefined();
  });
});
