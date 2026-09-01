import { describe, it, expect, vi, beforeAll } from "vitest";
import { checkComplianceHandler, registerComplianceTools } from "../../../src/mcp/compliance-tools";
import { getNamespace } from "@agentbadge/mcp";

vi.mock("../../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockResolvedValue({
    robotsTxt: "User-agent: *\nAllow: /",
    sitemapXml: "<urlset/>",
    openApiJson: { openapi: "3.0.0" },
    llmsTxt: "# Agent Readiness",
    homepageHtml: "<html></html>",
  }),
}));

vi.mock("../../../src/agent-readiness/ruleset", () => ({
  AGENT_READINESS_RULESET: {
    name: "agent-readiness",
    version: "1.4.0",
    scoring: { model: "v2-pillars" },
  },
}));

vi.mock("../../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [
        { rule_id: "AB-001", rule_name: "robots.txt", status: "VERIFIED", evidence: [], confidence: 0.95, category: "discovery" },
        { rule_id: "AB-002", rule_name: "sitemap.xml", status: "MISSING", evidence: [], confidence: 0.9, category: "discovery" },
      ],
    }),
  },
}));

vi.mock("../../../src/agent-readiness/scoring/scoring-engine", () => ({
  runScoringEngine: vi.fn().mockReturnValue({
    total: { score: 75, grade: "C+", rawScore: 75 },
    categories: {
      discovery: { score: 80, applicableCount: 5, category: "discovery" },
      documentation: { score: 70, applicableCount: 3, category: "documentation" },
    },
    pillars: {
      discovery: { pillar: "discovery", weight: 20, rawScore: 80, score: 80, categoryCount: 5, applicableCount: 5, floorTriggered: false },
      understandability: { pillar: "understandability", weight: 25, rawScore: 68, score: 68, categoryCount: 3, applicableCount: 3, floorTriggered: false },
      executability: { pillar: "executability", weight: 30, rawScore: 77, score: 77, categoryCount: 4, applicableCount: 4, floorTriggered: false },
      verifiability: { pillar: "verifiability", weight: 25, rawScore: 72, score: 72, categoryCount: 3, applicableCount: 3, floorTriggered: true },
    },
    delta: null,
    config: { pillarWeights: { discovery: 20, understandability: 25, executability: 30, verifiability: 25 } },
    computedAt: "2025-01-01T00:00:00Z",
  }),
}));

describe("SLICE-93-10: MCP check_compliance pillar scores", () => {
  beforeAll(() => {
    registerComplianceTools();
  });

  it("returns pillars array with 4 entries", async () => {
    const result = await checkComplianceHandler({ url: "https://example.com" });
    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    expect(parsed).toHaveProperty("pillars");
    expect(parsed.pillars).toBeInstanceOf(Array);
    expect(parsed.pillars).toHaveLength(4);
  });

  it("each pillar has pillar, label, question, weight, score, floorTriggered", async () => {
    const result = await checkComplianceHandler({ url: "https://example.com" });
    const parsed = JSON.parse(result.content[0].text);

    for (const p of parsed.pillars) {
      expect(p).toHaveProperty("pillar");
      expect(p).toHaveProperty("label");
      expect(p).toHaveProperty("question");
      expect(p).toHaveProperty("weight");
      expect(p).toHaveProperty("score");
      expect(p).toHaveProperty("floorTriggered");
      expect(typeof p.weight).toBe("number");
      expect(typeof p.score).toBe("number");
      expect(typeof p.floorTriggered).toBe("boolean");
    }
  });

  it("includes correct pillar labels and questions", async () => {
    const result = await checkComplianceHandler({ url: "https://example.com" });
    const parsed = JSON.parse(result.content[0].text);

    const labels = parsed.pillars.map((p: { label: string }) => p.label);
    expect(labels).toContain("Discovery");
    expect(labels).toContain("Understandability");
    expect(labels).toContain("Executability");
    expect(labels).toContain("Verifiability");

    const questions = parsed.pillars.map((p: { question: string }) => p.question);
    expect(questions).toContain("Can an agent find you?");
    expect(questions).toContain("Can an agent understand you?");
    expect(questions).toContain("Can an agent act on your API?");
    expect(questions).toContain("Can an agent verify what it observed?");
  });

  it("includes scoringModel field set to v2-pillars", async () => {
    const result = await checkComplianceHandler({ url: "https://example.com" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty("scoringModel");
    expect(parsed.scoringModel).toBe("v2-pillars");
  });

  it("preserves existing fields (score, checks, summary) — additive change", async () => {
    const result = await checkComplianceHandler({ url: "https://example.com" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty("score");
    expect(typeof parsed.score).toBe("number");
    expect(parsed).toHaveProperty("checks");
    expect(parsed).toHaveProperty("summary");
    expect(parsed.summary).toHaveProperty("totalChecks");
    expect(parsed.summary).toHaveProperty("passed");
    expect(parsed.summary).toHaveProperty("failed");
    expect(parsed.summary).toHaveProperty("skipped");
  });

  it("reflects floorTriggered for verifiability pillar", async () => {
    const result = await checkComplianceHandler({ url: "https://example.com" });
    const parsed = JSON.parse(result.content[0].text);

    const verifiability = parsed.pillars.find(
      (p: { pillar: string }) => p.pillar === "verifiability",
    );
    expect(verifiability.floorTriggered).toBe(true);
  });

  it("registered tool description mentions pillars", () => {
    const r = getNamespace("all")!;
    const tools = r.listTools();
    const tool = tools.find((t) => t.name === "check_compliance");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("pillar");
  });

  it("registered tool description mentions the four pillar names", () => {
    const r = getNamespace("all")!;
    const tools = r.listTools();
    const tool = tools.find((t) => t.name === "check_compliance");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Discovery");
    expect(tool!.description).toContain("Understandability");
    expect(tool!.description).toContain("Executability");
    expect(tool!.description).toContain("Verifiability");
  });
});
