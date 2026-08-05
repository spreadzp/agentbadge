import { describe, it, expect } from "vitest";
import { loadScoringConfig, DEFAULT_FLOOR_CAP, DEFAULT_FLOOR_CATEGORIES, DEFAULT_FLOOR_TRIGGER_SEVERITY } from "../../../src/agent-readiness/scoring/scoring-config";
import { DEFAULT_STATUS_CONTRIBUTIONS } from "../../../src/agent-readiness/scoring/scoring-types";

const mockManifest = {
  name: "agent-readiness",
  version: "1.2.0",
  categoryWeights: {
    discovery: 20,
    documentation: 25,
    actionability: 25,
    machine_readable: 20,
    verification: 10,
  },
};

describe("SLICE-35-2: Scoring Config", () => {
  it("loadScoringConfig returns ScoringConfig with weights from manifest", () => {
    const config = loadScoringConfig(mockManifest);
    expect(config.categoryWeights.discovery).toBe(20);
    expect(config.categoryWeights.documentation).toBe(25);
    expect(config.categoryWeights.verification).toBe(10);
  });

  it("loadScoringConfig uses default status contributions", () => {
    const config = loadScoringConfig(mockManifest);
    expect(config.statusContributions).toEqual(DEFAULT_STATUS_CONTRIBUTIONS);
    expect(config.statusContributions.VERIFIED).toBe(1.0);
    expect(config.statusContributions.INFERRED).toBe(0.7);
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
        discovery: 30,
        documentation: 20,
        actionability: 20,
        machine_readable: 15,
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
