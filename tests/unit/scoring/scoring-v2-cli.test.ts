import { describe, it, expect } from "vitest";
import { formatJsonApiOutput } from "../../../src/agent-readiness/cli/formatters/json-api-output";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { PILLAR_LABELS } from "../../../src/agent-readiness/scoring/pillar-map";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeGrade } from "../../../src/agent-readiness/scoring/grade-computer";

/**
 * SLICE-93-11: E2E — CLI path
 * Verifies that the CLI --json-api output includes pillars,
 * total = Σ pillar×weight, and grade is consistent.
 * Uses the golden assertions fixture to avoid network calls.
 */

const fixturePath = join(__dirname, "../../fixtures/scoring/golden-assertions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
const assertions = fixture.assertions as Assertion[];

const manifest = {
  name: "agent-readiness",
  version: "1.4.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  scoring: { pillars: { scoringModel: "v2-pillars" as const } },
};

const scoreResult = runScoringEngine({ assertions, rulesetManifest: manifest });
const score = scoreResult.total.score;
const grade = scoreResult.total.grade ?? computeGrade(score);

const jsonOutput = formatJsonApiOutput({
  url: "https://example.com",
  score,
  grade,
  assertions,
  categoryScores: Object.values(scoreResult.categories),
  pillars: scoreResult.pillars,
});

const parsed = JSON.parse(jsonOutput);

describe("SLICE-93-11: CLI --json-api output has pillars", () => {
  it("output is valid JSON", () => {
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  it("has pillars array with 4 entries", () => {
    expect(parsed.pillars).toBeDefined();
    expect(Array.isArray(parsed.pillars)).toBe(true);
    expect(parsed.pillars).toHaveLength(4);
  });

  it("each pillar has required fields", () => {
    for (const p of parsed.pillars) {
      expect(p.pillar).toBeDefined();
      expect(p.label).toBeDefined();
      expect(p.weight).toBeDefined();
      expect(p.score).toBeDefined();
      expect(p.rawScore).toBeDefined();
      expect(p.floorTriggered).toBeDefined();
    }
  });

  it("pillar labels match PILLAR_LABELS", () => {
    for (const p of parsed.pillars) {
      expect(p.label).toBe(PILLAR_LABELS[p.pillar as keyof typeof PILLAR_LABELS]);
    }
  });

  it("total score = Σ pillar.score × weight / 100", () => {
    const computed = parsed.pillars.reduce(
      (sum: number, p: { score: number; weight: number }) => sum + (p.score * p.weight) / 100,
      0,
    );
    const rounded = Math.round(computed * 100) / 100;
    expect(rounded).toBe(scoreResult.total.rawScore);
  });

  it("grade is consistent with score", () => {
    expect(parsed.grade).toBe(grade);
    expect(parsed.grade).toBe(computeGrade(score));
  });

  it("discovery pillar has floorTriggered=true (golden fixture)", () => {
    const discovery = parsed.pillars.find((p: { pillar: string }) => p.pillar === "discovery");
    expect(discovery.floorTriggered).toBe(true);
  });

  it("score field matches scoreResult.total.score", () => {
    expect(parsed.score).toBe(score);
  });
});
