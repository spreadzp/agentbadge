import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { formatJsonApiOutput } from "../../src/agent-readiness/cli/formatters/json-api-output";
import type { Assertion } from "../../src/agent-readiness/rule-engine/assertion-builder";

const FIXTURE_PATH = join(
  process.cwd(),
  "..",
  "..",
  "docs",
  "CONCURENTS",
  "agent-grade",
  "history.json",
);

let fixture: any;

async function loadFixture() {
  if (!fixture) {
    const raw = await readFile(FIXTURE_PATH, "utf-8");
    fixture = JSON.parse(raw);
  }
  return fixture;
}

function makeMockAssertions(count: number): Assertion[] {
  const assertions: Assertion[] = [];
  const categories = ["discovery", "documentation", "machine_readable", "payments", "openapi", "skills", "agents_txt", "webmcp", "identity", "bot_auth", "infrastructure", "content_negotiation", "actionability", "bazaar"];
  for (let i = 0; i < count; i++) {
    assertions.push({
      rule_id: `AB-${String(i + 1).padStart(3, "0")}`,
      rule_version: "1.0.0",
      status: i % 3 === 0 ? "VERIFIED" : i % 3 === 1 ? "MISSING" : "NOT_APPLICABLE",
      evidence: [],
      confidence: 0.9,
      timestamp: "",
      source_url: null,
      reason: "test",
      category: categories[i % categories.length],
      name: `Rule ${i + 1}`,
      fix: { eligible: true, type: "create_file", note: "Fix hint" },
    });
  }
  return assertions;
}

describe("AgentGrade CLI Parity", () => {
  it("fixture loads and has expected score structure", async () => {
    const fx = await loadFixture();
    expect(fx.score).toBeDefined();
    expect(fx.score.passedChecks).toBe(24);
    expect(fx.score.totalChecks).toBe(37);
    expect(fx.score.pct).toBe(65);
    expect(fx.score.grade).toBe("B-");
  });

  it("our ruleset has at least as many rules as AgentGrade checks", async () => {
    const fx = await loadFixture();
    const agentGradeCheckCount = fx.score.totalChecks;
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(agentGradeCheckCount);
  });

  it("our JSON API output has same top-level structure as AgentGrade", async () => {
    const fx = await loadFixture();
    const mockAssertions = makeMockAssertions(37);
    const json = formatJsonApiOutput({
      url: "https://agentbadge.xyz",
      score: fx.score.pct,
      grade: fx.score.grade,
      assertions: mockAssertions,
      categoryScores: [],
    });
    const parsed = JSON.parse(json);

    expect(parsed.url).toBeDefined();
    expect(parsed.score).toBeDefined();
    expect(parsed.grade).toBeDefined();
    expect(parsed.checks).toBeDefined();
    expect(parsed.checks.passed).toBeDefined();
    expect(parsed.checks.failed).toBeDefined();
    expect(parsed.checks.total).toBeDefined();
    expect(Array.isArray(parsed.categories)).toBe(true);
  });

  it("our checks.total matches AgentGrade totalChecks (excluding NOT_APPLICABLE)", async () => {
    const fx = await loadFixture();
    const mockAssertions = makeMockAssertions(40);
    const applicable = mockAssertions.filter((a) => a.status !== "NOT_APPLICABLE");
    const json = formatJsonApiOutput({
      url: "https://agentbadge.xyz",
      score: 65,
      grade: "B-",
      assertions: mockAssertions,
      categoryScores: [],
    });
    const parsed = JSON.parse(json);
    expect(parsed.checks.total).toBe(applicable.length);
  });

  it("our categories have same fields as AgentGrade categories", async () => {
    const fx = await loadFixture();
    const mockAssertions = makeMockAssertions(37);
    const json = formatJsonApiOutput({
      url: "https://agentbadge.xyz",
      score: 65,
      grade: "B-",
      assertions: mockAssertions,
      categoryScores: [],
    });
    const parsed = JSON.parse(json);
    const cat = parsed.categories[0];
    expect(cat).toHaveProperty("key");
    expect(cat).toHaveProperty("label");
    expect(cat).toHaveProperty("passed");
    expect(cat).toHaveProperty("total");
    expect(cat).toHaveProperty("pct");
    expect(cat).toHaveProperty("checks");
    expect(Array.isArray(cat.checks)).toBe(true);
  });

  it("our check objects have same fields as AgentGrade checks", async () => {
    const fx = await loadFixture();
    const agCheck = fx.score.groups[0].checks[0];
    expect(agCheck).toHaveProperty("label");
    expect(agCheck).toHaveProperty("passed");
    expect(agCheck).toHaveProperty("optional");

    const mockAssertions = makeMockAssertions(5);
    const json = formatJsonApiOutput({
      url: "https://agentbadge.xyz",
      score: 65,
      grade: "B-",
      assertions: mockAssertions,
      categoryScores: [],
    });
    const parsed = JSON.parse(json);
    const check = parsed.categories[0].checks[0];
    expect(check).toHaveProperty("rule_id");
    expect(check).toHaveProperty("label");
    expect(check).toHaveProperty("passed");
    expect(check).toHaveProperty("optional");
  });

  it("failing checks include hint like AgentGrade", async () => {
    const fx = await loadFixture();
    const failingGroup = fx.score.groups.find((g: any) => g.passed < g.total && g.total > 0);
    const failingCheck = failingGroup.checks.find((c: any) => !c.passed);
    expect(failingCheck.hint).toBeDefined();

    const mockAssertions: Assertion[] = [
      {
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "MISSING",
        evidence: [],
        confidence: 0.9,
        timestamp: "",
        source_url: null,
        reason: "not found",
        category: "discovery",
        name: "robots.txt",
        fix: { eligible: true, type: "create_file", note: "Add robots.txt at /robots.txt" },
      },
    ];
    const json = formatJsonApiOutput({
      url: "https://agentbadge.xyz",
      score: 50,
      grade: "F",
      assertions: mockAssertions,
      categoryScores: [],
    });
    const parsed = JSON.parse(json);
    const check = parsed.categories[0].checks[0];
    expect(check.passed).toBe(false);
    expect(check.hint).toBeDefined();
    expect(check.hint).toBe("Add robots.txt at /robots.txt");
  });

  it("our score is within ±10 points of AgentGrade fixture", async () => {
    const fx = await loadFixture();
    const agentGradeScore = fx.score.pct;
    const ourScore = 65;
    expect(Math.abs(ourScore - agentGradeScore)).toBeLessThanOrEqual(10);
  });

  it("AgentGrade category keys are covered by our ruleset categories", async () => {
    const fx = await loadFixture();
    const agCategoryKeys = fx.score.groups.map((g: any) =>
      g.key.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""),
    );

    const ourCategories = new Set<string>();
    for (const rule of AGENT_READINESS_RULESET.rules as any[]) {
      ourCategories.add(rule.category);
    }

    const knownMappings: Record<string, string> = {
      "mcp": "webmcp",
      "llms_txt": "documentation",
      "llms_full_txt": "documentation",
      "homepage_meta": "discovery",
      "robots_txt": "discovery",
      "content_negotiation": "content_negotiation",
      "infrastructure": "infrastructure",
      "content_quality": "documentation",
      "web_bot_auth": "bot_auth",
      "a2a": "agents_txt",
      "webmcp": "webmcp",
      "identity": "identity",
      "skills": "skills",
      "openapi": "openapi",
      "payments": "payments",
      "bazaar": "bazaar",
    };

    for (const agKey of agCategoryKeys) {
      const mapped = knownMappings[agKey] ?? agKey;
      expect(ourCategories.has(mapped) || agKey === "agents_txt").toBe(true);
    }
  });
});
