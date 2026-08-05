import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { allVerified, mixedStatus } from "../../fixtures/scoring";

const mockManifest = {
  name: "agent-readiness",
  version: "1.2.0",
  categoryWeights: {
    discovery: 25,
    documentation: 25,
    actionability: 20,
    machine_readable: 20,
    verification: 10,
  },
};

describe("SLICE-35-9: Anti-Pattern Guards", () => {
  it("confidence change alone does not affect total score", () => {
    const result1 = runScoringEngine({
      assertions: allVerified,
      rulesetManifest: mockManifest,
    });

    const lowConfidence = allVerified.map((a) => ({ ...a, confidence: 0.1 }));
    const result2 = runScoringEngine({
      assertions: lowConfidence,
      rulesetManifest: mockManifest,
    });

    expect(result2.total.score).toBe(result1.total.score);
  });

  it("determinism: same input produces identical output (except computedAt)", () => {
    const input = {
      assertions: allVerified,
      rulesetManifest: mockManifest,
    };
    const result1 = runScoringEngine(input);
    const result2 = runScoringEngine(input);

    const r1 = { ...result1, computedAt: "X" };
    const r2 = { ...result2, computedAt: "X" };
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("no Math.random or Date.now in scoring modules (excluding scoring-engine.ts)", () => {
    const scoringSource = [
      "scoring-config.ts",
      "category-scorer.ts",
      "floor-enforcer.ts",
      "total-scorer.ts",
      "delta-computer.ts",
    ];
    for (const file of scoringSource) {
      const content = readFileSync(
        join(__dirname, `../../../src/agent-readiness/scoring/${file}`),
        "utf-8",
      );
      expect(content).not.toMatch(/Math\.random/);
      expect(content).not.toMatch(/Date\.now\(\)/);
    }
  });

  it("INFERRED status always contributes exactly 70% regardless of confidence value", () => {
    const highConf = mixedStatus.map((a) => ({ ...a, confidence: 1.0 }));
    const lowConf = mixedStatus.map((a) => ({ ...a, confidence: 0.1 }));

    const result1 = runScoringEngine({
      assertions: highConf,
      rulesetManifest: mockManifest,
    });
    const result2 = runScoringEngine({
      assertions: lowConf,
      rulesetManifest: mockManifest,
    });

    expect(result2.total.score).toBe(result1.total.score);
  });

  it("confidence = 0 does not change score", () => {
    const zeroConf = allVerified.map((a) => ({ ...a, confidence: 0 }));
    const result = runScoringEngine({
      assertions: zeroConf,
      rulesetManifest: mockManifest,
    });
    const baseline = runScoringEngine({
      assertions: allVerified,
      rulesetManifest: mockManifest,
    });
    expect(result.total.score).toBe(baseline.total.score);
  });

  it("confidence = NaN does not change score", () => {
    const nanConf = allVerified.map((a) => ({ ...a, confidence: NaN }));
    const result = runScoringEngine({
      assertions: nanConf,
      rulesetManifest: mockManifest,
    });
    const baseline = runScoringEngine({
      assertions: allVerified,
      rulesetManifest: mockManifest,
    });
    expect(result.total.score).toBe(baseline.total.score);
  });
});
