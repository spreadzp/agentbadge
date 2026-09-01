import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SLICE-93-11: E2E — web path
 * POST /api/total-scan → collect SSE events → result event has pillars,
 * legacy fields, and score is consistent with the scoring engine.
 * This is the dual-scoring death certificate: web score === CLI score for same input.
 */

const fixturePath = join(__dirname, "../../fixtures/scoring/golden-assertions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
const goldenAssertions = fixture.assertions;

vi.mock("../../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockImplementation(async (_url: string, opts?: { onProgress?: (resource: string, completed: number, total: number) => void }) => {
    const resources = ["robots", "sitemap", "openapi"];
    resources.forEach((r, i) => opts?.onProgress?.(r, i + 1, resources.length));
    return { snapshots: {} };
  }),
}));

vi.mock("../../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: goldenAssertions,
      totalRules: goldenAssertions.length,
    }),
  },
}));

vi.mock("../../../src/agent-readiness/ruleset", () => ({
  AGENT_READINESS_RULESET: {
    name: "agent-readiness",
    version: "1.4.0",
    rules: [],
    scoring: {
      pillars: {
        weights: { discovery: 20, understandability: 25, executability: 30, verifiability: 25 },
        scoringModel: "v2-pillars" as const,
      },
    },
  },
}));

import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { formatJsonApiOutput } from "../../../src/agent-readiness/cli/formatters/json-api-output";
import { computeGrade } from "../../../src/agent-readiness/scoring/grade-computer";

let app: Hono;

beforeAll(async () => {
  const { totalScanRoutes } = await import("../../../src/server/routes/total-scan-api");
  app = new Hono();
  app.route("/api", totalScanRoutes);
});

// Compute the CLI-equivalent score for the same assertions (dual-scoring comparison)
const manifest = {
  name: "agent-readiness",
  version: "1.4.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  scoring: { pillars: { scoringModel: "v2-pillars" as const } },
};
const cliScoreResult = runScoringEngine({ assertions: goldenAssertions, rulesetManifest: manifest });
const cliScore = cliScoreResult.total.score;

const cliJsonOutput = formatJsonApiOutput({
  url: "https://example.com",
  score: cliScore,
  grade: cliScoreResult.total.grade ?? computeGrade(cliScore),
  assertions: goldenAssertions,
  categoryScores: Object.values(cliScoreResult.categories),
  pillars: cliScoreResult.pillars,
});
const cliParsed = JSON.parse(cliJsonOutput);

describe("SLICE-93-11: Web /api/total-scan SSE has pillars (dual-scoring death certificate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SSE result event contains pillars array with 4 entries", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    expect(resultMatch).not.toBeNull();
    const result = JSON.parse(resultMatch![1]);

    expect(result.pillars).toBeDefined();
    expect(Array.isArray(result.pillars)).toBe(true);
    expect(result.pillars).toHaveLength(4);
  });

  it("SSE result pillars have required fields", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    const result = JSON.parse(resultMatch![1]);

    for (const p of result.pillars) {
      expect(p).toHaveProperty("pillar");
      expect(p).toHaveProperty("label");
      expect(p).toHaveProperty("weight");
      expect(p).toHaveProperty("score");
      expect(p).toHaveProperty("floorTriggered");
    }
  });

  it("SSE result has legacy fields (score, categories, summary)", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    const result = JSON.parse(resultMatch![1]);

    expect(result.score).toBeDefined();
    expect(result.grade).toBeDefined();
    expect(result.categories).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.total_rules).toBeDefined();
  });

  it("web score === CLI score for same assertions (dual-scoring unification)", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    const result = JSON.parse(resultMatch![1]);

    expect(result.score).toBe(cliScore);
    expect(result.score).toBe(cliParsed.score);
  });

  it("SSE result has floorTriggered and floorReason fields", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    const result = JSON.parse(resultMatch![1]);

    expect(result.floorTriggered).toBe(true);
    expect(result.floorReason).toContain("AB-002");
  });

  it("SSE done event has completed: true", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    expect(text).toContain("event: done");
    expect(text).toContain('"completed":true');
  });
});
