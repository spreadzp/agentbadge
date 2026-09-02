import { describe, it, expect } from "vitest";
import { loadScoringConfig } from "../../../src/agent-readiness/scoring/scoring-config";
import {
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_PILLAR_WEIGHTS,
} from "../../../src/agent-readiness/scoring/scoring-types";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";

const baseManifest: RulesetManifest = {
  name: "agent-readiness",
  version: "2.1.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

describe("SLICE-93-6: Config-driven pillar weights", () => {
  it("manifest WITHOUT scoring section → defaults resolved (backward compat)", () => {
    const config = loadScoringConfig(baseManifest);
    expect(config.pillarWeights).toEqual(DEFAULT_PILLAR_WEIGHTS);
    expect(config.scoringModel).toBe("v2-pillars");
  });

  it("manifest WITH partial weights → merge with defaults per-key", () => {
    const manifest: RulesetManifest = {
      ...baseManifest,
      scoring: {
        pillars: {
          weights: { discovery: 30 },
        },
      },
    };
    const config = loadScoringConfig(manifest);
    expect(config.pillarWeights.discovery).toBe(30);
    expect(config.pillarWeights.understandability).toBe(25);
    expect(config.pillarWeights.executability).toBe(30);
    expect(config.pillarWeights.verifiability).toBe(25);
  });

  it("manifest WITH full scoring section → exact values used", () => {
    const manifest: RulesetManifest = {
      ...baseManifest,
      scoring: {
        pillars: {
          weights: { discovery: 10, understandability: 20, executability: 40, verifiability: 30 },
          scoringModel: "v1-categories",
        },
      },
    };
    const config = loadScoringConfig(manifest);
    expect(config.pillarWeights).toEqual({
      discovery: 10,
      understandability: 20,
      executability: 40,
      verifiability: 30,
    });
    expect(config.scoringModel).toBe("v1-categories");
  });

  it("invalid pillar name in weights → throws descriptive error", () => {
    const manifest = {
      ...baseManifest,
      scoring: {
        pillars: {
          weights: { unknown_pillar: 50 },
        },
      },
    } as unknown as RulesetManifest;
    expect(() => loadScoringConfig(manifest)).toThrow(/unknown_pillar|invalid pillar/i);
  });

  it("negative weight → throws descriptive error", () => {
    const manifest: RulesetManifest = {
      ...baseManifest,
      scoring: {
        pillars: {
          weights: { discovery: -5 },
        },
      },
    };
    expect(() => loadScoringConfig(manifest)).toThrow(/positive|invalid|negative/i);
  });

  it("scoringModel override v1-categories → flows into ScoringConfig", () => {
    const manifest: RulesetManifest = {
      ...baseManifest,
      scoring: {
        pillars: {
          scoringModel: "v1-categories",
        },
      },
    };
    const config = loadScoringConfig(manifest);
    expect(config.scoringModel).toBe("v1-categories");
  });

  it("top-level scoringModel still works (backward compat with 93-5)", () => {
    const manifest: RulesetManifest = {
      ...baseManifest,
      scoringModel: "v1-categories",
    };
    const config = loadScoringConfig(manifest);
    expect(config.scoringModel).toBe("v1-categories");
  });

  it("scoring.pillars.scoringModel takes precedence over top-level scoringModel", () => {
    const manifest: RulesetManifest = {
      ...baseManifest,
      scoringModel: "v1-categories",
      scoring: {
        pillars: {
          scoringModel: "v2-pillars",
        },
      },
    };
    const config = loadScoringConfig(manifest);
    expect(config.scoringModel).toBe("v2-pillars");
  });
});
