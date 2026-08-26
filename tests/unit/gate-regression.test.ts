import { describe, it, expect } from "vitest";
import { formatScanReport } from "../../src/agent-readiness/report-formatter";
import type { RuleEngineResult } from "../../src/agent-readiness/rule-engine/rule-engine";
import type { Assertion } from "../../src/agent-readiness/rule-engine/assertion-builder";
import { PLATFORM_NAMES } from "../../src/views/blog-article";
import type { BlogExternalLink } from "../../src/server/lib/blog-data";

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string }): Assertion {
  return {
    rule_version: "1.0.0",
    status: "VERIFIED" as never,
    evidence: [],
    confidence: 1.0,
    timestamp: "2026-01-01T00:00:00Z",
    source_url: null,
    reason: "test",
    category: "discovery",
    name: "Test Rule",
    ...overrides,
  } as Assertion;
}

describe("SLICE-86-2 regression: report-formatter SKIPPED status", () => {
  it("counts SKIPPED assertions without crashing", () => {
    const mockAssertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED" as never }),
      makeAssertion({ rule_id: "AB-002", status: "SKIPPED" as never }),
      makeAssertion({ rule_id: "AB-003", status: "MISSING" as never, category: "documentation" }),
    ];

    const result = formatScanReport("https://example.com", {
      assertions: mockAssertions,
      rules: [],
    } as unknown as RuleEngineResult);

    expect(result.skipped).toBe(1);
    expect(result.total_rules).toBe(3);
    expect(result.verified).toBe(1);
    expect(result.missing).toBe(1);
  });
});

describe("SLICE-86-2 regression: blog-article PLATFORM_NAMES completeness", () => {
  const expectedPlatforms: BlogExternalLink["platform"][] = [
    "devto",
    "medium",
    "linkedin",
    "hackernews",
    "hackernoon",
    "reddit",
    "github",
    "hashnode",
    "twitter",
    "qiita",
    "zenn",
    "velog",
    "hsoub",
  ];

  for (const platform of expectedPlatforms) {
    it(`has a display name for ${platform}`, () => {
      expect(PLATFORM_NAMES[platform]).toBeDefined();
      expect(typeof PLATFORM_NAMES[platform]).toBe("string");
      expect(PLATFORM_NAMES[platform].length).toBeGreaterThan(0);
    });
  }

  it("PLATFORM_NAMES has exactly the same keys as BlogExternalLink platform union", () => {
    const keys = Object.keys(PLATFORM_NAMES);
    expect(keys).toHaveLength(expectedPlatforms.length);
    for (const p of expectedPlatforms) {
      expect(keys).toContain(p);
    }
  });
});
