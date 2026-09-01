import { describe, it, expect } from "vitest";
import { formatJsonApiOutput } from "../../../../src/agent-readiness/cli/formatters/json-api-output";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { CategoryScore, PillarScore } from "../../../../src/agent-readiness/scoring/scoring-types";

function makePillarScore(overrides: Partial<PillarScore> = {}): PillarScore {
  return {
    pillar: "discovery",
    weight: 20,
    rawScore: 90,
    score: 90,
    categoryCount: 8,
    applicableCount: 8,
    floorTriggered: false,
    ...overrides,
  };
}

function makeAssertion(overrides: Partial<Assertion> = {}): Assertion {
  return {
    rule_id: "AB-001",
    rule_version: "1.0.0",
    status: "VERIFIED",
    evidence: [],
    confidence: 1.0,
    timestamp: "",
    source_url: null,
    reason: "ok",
    category: "discovery",
    name: "robots.txt present",
    fix: { eligible: true, type: "create_file", note: "Add robots.txt at /robots.txt" },
    ...overrides,
  };
}

function makeCategoryScore(overrides: Partial<CategoryScore> = {}): CategoryScore {
  return {
    category: "discovery",
    weight: 15,
    rawScore: 80,
    score: 80,
    ruleCount: 5,
    applicableCount: 5,
    floorTriggered: false,
    ...overrides,
  };
}

describe("formatJsonApiOutput", () => {
  it("includes top-level url, score, grade, checks, categories", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 72,
      grade: "C",
      assertions: [makeAssertion()],
      categoryScores: [makeCategoryScore()],
    });
    const parsed = JSON.parse(json);
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.score).toBe(72);
    expect(parsed.grade).toBe("C");
    expect(parsed.checks).toBeDefined();
    expect(parsed.categories).toBeDefined();
    expect(Array.isArray(parsed.categories)).toBe(true);
  });

  it("checks object has passed, failed, total", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 50,
      grade: "F",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED" }),
        makeAssertion({ rule_id: "AB-002", status: "MISSING" }),
        makeAssertion({ rule_id: "AB-003", status: "VERIFIED" }),
        makeAssertion({ rule_id: "AB-004", status: "NOT_APPLICABLE" }),
      ],
      categoryScores: [],
    });
    const parsed = JSON.parse(json);
    expect(parsed.checks.passed).toBe(2);
    expect(parsed.checks.failed).toBe(1);
    expect(parsed.checks.total).toBe(3);
  });

  it("each category has key, label, passed, total, pct, checks array", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 80,
      grade: "B",
      assertions: [
        makeAssertion({ rule_id: "AB-001", category: "discovery", status: "VERIFIED", name: "robots.txt" }),
        makeAssertion({ rule_id: "AB-002", category: "discovery", status: "MISSING", name: "sitemap.xml" }),
      ],
      categoryScores: [makeCategoryScore({ category: "discovery", ruleCount: 2, applicableCount: 2 })],
    });
    const parsed = JSON.parse(json);
    const cat = parsed.categories[0];
    expect(cat.key).toBe("discovery");
    expect(cat.label).toBe("Discovery");
    expect(cat.passed).toBe(1);
    expect(cat.total).toBe(2);
    expect(cat.pct).toBe(50);
    expect(Array.isArray(cat.checks)).toBe(true);
    expect(cat.checks).toHaveLength(2);
  });

  it("each check has rule_id, label, passed, optional", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 80,
      grade: "B",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED", name: "robots.txt present" }),
        makeAssertion({ rule_id: "AB-002", status: "MISSING", name: "sitemap.xml present" }),
      ],
      categoryScores: [makeCategoryScore()],
    });
    const parsed = JSON.parse(json);
    const check = parsed.categories[0].checks[0];
    expect(check.rule_id).toBe("AB-001");
    expect(check.label).toBe("robots.txt present");
    expect(check.passed).toBe(true);
    expect(check.optional).toBeDefined();
  });

  it("failing check includes hint from fix.note", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 50,
      grade: "F",
      assertions: [
        makeAssertion({
          rule_id: "AB-002",
          status: "MISSING",
          name: "sitemap.xml present",
          fix: { eligible: true, type: "create_file", note: "Add sitemap.xml at /sitemap.xml" },
        }),
      ],
      categoryScores: [makeCategoryScore()],
    });
    const parsed = JSON.parse(json);
    const check = parsed.categories[0].checks[0];
    expect(check.passed).toBe(false);
    expect(check.hint).toBe("Add sitemap.xml at /sitemap.xml");
  });

  it("passing check does not include hint", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 100,
      grade: "A+",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED", name: "robots.txt" }),
      ],
      categoryScores: [makeCategoryScore()],
    });
    const parsed = JSON.parse(json);
    const check = parsed.categories[0].checks[0];
    expect(check.passed).toBe(true);
    expect(check.hint).toBeUndefined();
  });

  it("compact mode produces minified JSON", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 100,
      grade: "A+",
      assertions: [makeAssertion()],
      categoryScores: [makeCategoryScore()],
      compact: true,
    });
    expect(json).not.toContain("\n");
    expect(json).not.toContain("  ");
  });

  it("includes reportUrl when provided", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 100,
      grade: "A+",
      assertions: [makeAssertion()],
      categoryScores: [makeCategoryScore()],
      reportUrl: "https://agentbadge.xyz/report/123",
    });
    const parsed = JSON.parse(json);
    expect(parsed.reportUrl).toBe("https://agentbadge.xyz/report/123");
  });

  it("NOT_APPLICABLE assertions are excluded from checks count", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: 100,
      grade: "A+",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED" }),
        makeAssertion({ rule_id: "AB-002", status: "NOT_APPLICABLE" }),
      ],
      categoryScores: [],
    });
    const parsed = JSON.parse(json);
    expect(parsed.checks.total).toBe(1);
    expect(parsed.checks.passed).toBe(1);
    expect(parsed.checks.failed).toBe(0);
  });

  // SLICE-93-9: Pillar output tests
  describe("pillar output", () => {
    const pillars = {
      discovery: makePillarScore({ pillar: "discovery", weight: 20, rawScore: 90, score: 90 }),
      understandability: makePillarScore({ pillar: "understandability", weight: 25, rawScore: 68, score: 68 }),
      executability: makePillarScore({ pillar: "executability", weight: 30, rawScore: 77, score: 77 }),
      verifiability: makePillarScore({ pillar: "verifiability", weight: 25, rawScore: 72, score: 72 }),
    };

    it("includes pillars array in JSON output", () => {
      const json = formatJsonApiOutput({
        url: "https://example.com",
        score: 76,
        grade: "B",
        assertions: [makeAssertion()],
        categoryScores: [makeCategoryScore()],
        pillars,
      });
      const parsed = JSON.parse(json);
      expect(parsed.pillars).toBeDefined();
      expect(Array.isArray(parsed.pillars)).toBe(true);
      expect(parsed.pillars).toHaveLength(4);
    });

    it("first pillar has pillar key === discovery", () => {
      const json = formatJsonApiOutput({
        url: "https://example.com",
        score: 76,
        grade: "B",
        assertions: [makeAssertion()],
        categoryScores: [makeCategoryScore()],
        pillars,
      });
      const parsed = JSON.parse(json);
      expect(parsed.pillars[0].pillar).toBe("discovery");
    });

    it("each pillar has pillar, label, weight, score, rawScore, floorTriggered", () => {
      const json = formatJsonApiOutput({
        url: "https://example.com",
        score: 76,
        grade: "B",
        assertions: [makeAssertion()],
        categoryScores: [makeCategoryScore()],
        pillars,
      });
      const parsed = JSON.parse(json);
      for (const p of parsed.pillars) {
        expect(p.pillar).toBeDefined();
        expect(p.label).toBeDefined();
        expect(p.weight).toBeDefined();
        expect(p.score).toBeDefined();
        expect(p.rawScore).toBeDefined();
        expect(p.floorTriggered).toBeDefined();
      }
    });

    it("legacy keys still present when pillars added (additive check)", () => {
      const json = formatJsonApiOutput({
        url: "https://example.com",
        score: 76,
        grade: "B",
        assertions: [makeAssertion()],
        categoryScores: [makeCategoryScore()],
        pillars,
      });
      const parsed = JSON.parse(json);
      expect(parsed.url).toBe("https://example.com");
      expect(parsed.score).toBe(76);
      expect(parsed.grade).toBe("B");
      expect(parsed.checks).toBeDefined();
      expect(parsed.categories).toBeDefined();
    });

    it("omits pillars key when not provided (degradation)", () => {
      const json = formatJsonApiOutput({
        url: "https://example.com",
        score: 76,
        grade: "B",
        assertions: [makeAssertion()],
        categoryScores: [makeCategoryScore()],
      });
      const parsed = JSON.parse(json);
      expect(parsed.pillars).toBeUndefined();
    });
  });
});
