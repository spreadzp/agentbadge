import { describe, it, expect } from "vitest";
import { loadScoringConfig, DEFAULT_FLOOR_CAP, DEFAULT_FLOOR_CATEGORIES, DEFAULT_FLOOR_TRIGGER_SEVERITY } from "../../../src/agent-readiness/scoring/scoring-config";
import { DEFAULT_STATUS_CONTRIBUTIONS, DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";

const mockManifest = {
  name: "agent-readiness",
  version: "1.2.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

describe("SLICE-35-2: Scoring Config", () => {
  it("loadScoringConfig returns ScoringConfig with weights from manifest", () => {
    const config = loadScoringConfig(mockManifest);
    expect(config.categoryWeights.discovery).toBe(15);
    expect(config.categoryWeights.documentation).toBe(15);
    expect(config.categoryWeights.verification).toBe(5);
  });

  it("loadScoringConfig uses default status contributions", () => {
    const config = loadScoringConfig(mockManifest);
    expect(config.statusContributions).toEqual(DEFAULT_STATUS_CONTRIBUTIONS);
    expect(config.statusContributions.VERIFIED).toBe(1.0);
    expect(config.statusContributions.INFERRED).toBe(0.6);
  });

  it("default floor cap is 40", () => {
    expect(DEFAULT_FLOOR_CAP).toBe(40);
    const config = loadScoringConfig(mockManifest);
    expect(config.floorCap).toBe(40);
  });

  it("default floor categories are discovery and documentation", () => {
    expect(DEFAULT_FLOOR_CATEGORIES).toContain("discovery");
    expect(DEFAULT_FLOOR_CATEGORIES).toContain("documentation");
    const config = loadScoringConfig(mockManifest);
    expect(config.floorCategories).toContain("discovery");
    expect(config.floorCategories).toContain("documentation");
  });

  it("default floor trigger severity is high", () => {
    expect(DEFAULT_FLOOR_TRIGGER_SEVERITY).toContain("high");
    const config = loadScoringConfig(mockManifest);
    expect(config.floorTriggerSeverity).toContain("high");
  });

  it("category weights are NOT hardcoded — they come from manifest", () => {
    const customManifest = {
      ...mockManifest,
      categoryWeights: {
        ...DEFAULT_CATEGORY_WEIGHTS,
        discovery: 30,
        documentation: 20,
        verification: 15,
      },
    };
    const config = loadScoringConfig(customManifest);
    expect(config.categoryWeights.discovery).toBe(30);
    expect(config.categoryWeights.verification).toBe(15);
  });

  it("returns a valid ScoringConfig object with all required fields", () => {
    const config = loadScoringConfig(mockManifest);
    expect(config).toHaveProperty("categoryWeights");
    expect(config).toHaveProperty("statusContributions");
    expect(config).toHaveProperty("floorCap");
    expect(config).toHaveProperty("floorCategories");
    expect(config).toHaveProperty("floorTriggerSeverity");
  });
});
