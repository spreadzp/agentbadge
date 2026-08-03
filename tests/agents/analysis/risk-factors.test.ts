import { describe, it, expect } from "vitest";
import { computeRiskFactors } from "../../../src/agents/analysis/risk-factors";
import type { TypedDataset, ColumnSummary } from "../../../src/agents/types";

function makeStats(overrides: Partial<ColumnSummary> = {}): ColumnSummary {
  return {
    name: "glucose",
    type: "number",
    count: 768,
    nullCount: 0,
    uniqueCount: 136,
    mean: 121.7,
    median: 117,
    stdDev: 30.5,
    min: 0,
    max: 199,
    q1: 99,
    q3: 140,
    iqr: 41,
    ...overrides,
  };
}

describe("SLICE-26-6: Risk Factors Analysis", () => {
  const pimaDataset: TypedDataset = {
    columns: ["pregnancies", "glucose", "bloodPressure", "bmi", "age", "outcome"],
    types: ["number", "number", "number", "number", "number", "number"],
    rows: [
      [6, 148, 72, 33.6, 50, 1],
      [1, 85, 66, 26.6, 31, 0],
      [8, 183, 64, 23.3, 32, 1],
      [1, 89, 66, 28.1, 21, 0],
      [0, 137, 40, 43.1, 33, 1],
    ],
  };

  const pimaStats: ColumnSummary[] = [
    makeStats({ name: "pregnancies", mean: 3.85, median: 3 }),
    makeStats({ name: "glucose", mean: 140 }),
    makeStats({ name: "bloodPressure", mean: 72.4, median: 72 }),
    makeStats({ name: "bmi", mean: 32.5, median: 32.3 }),
    makeStats({ name: "age", mean: 33.2, median: 29 }),
    makeStats({ name: "outcome", mean: 0.35, median: 0 }),
  ];

  describe("computeRiskFactors — Pima (diabetes)", () => {
    const results = computeRiskFactors(pimaDataset, pimaStats, "pima");

    it("returns at least one risk factor", () => {
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("factorName is Diabetes Risk", () => {
      expect(results[0].factorName).toBe("Diabetes Risk");
    });

    it("datasetType is pima", () => {
      expect(results[0].datasetType).toBe("pima");
    });

    it("score is a non-negative number", () => {
      expect(results[0].score).toBeGreaterThanOrEqual(0);
    });

    it("severity is one of valid values", () => {
      const valid = ["minimal", "low", "moderate", "high"];
      expect(valid).toContain(results[0].severity);
    });

    it("contributingFactors is an array", () => {
      expect(Array.isArray(results[0].contributingFactors)).toBe(true);
    });

    it("glossaryTerms is an array", () => {
      expect(Array.isArray(results[0].glossaryTerms)).toBe(true);
    });

    it("glucose contributing factor has glossaryTerm", () => {
      const glucoseFactor = results[0].contributingFactors.find(
        (f) => f.metric.toLowerCase() === "glucose"
      );
      expect(glucoseFactor).toBeDefined();
      expect(glucoseFactor!.glossaryTerm).toContain("glossaryTerm");
    });
  });

  describe("computeRiskFactors — unknown dataset type", () => {
    it("returns empty array for unknown type", () => {
      const results = computeRiskFactors(pimaDataset, pimaStats, "unknown");
      expect(results).toHaveLength(0);
    });
  });

  describe("severity thresholds", () => {
    it("high severity when score >= threshold", () => {
      const highGlucoseStats: ColumnSummary[] = [
        makeStats({ name: "glucose", mean: 180 }),
        makeStats({ name: "bmi", mean: 40 }),
        makeStats({ name: "age", mean: 55 }),
      ];
      const results = computeRiskFactors(pimaDataset, highGlucoseStats, "pima");
      expect(results[0].severity).toBe("high");
    });

    it("minimal severity when score is 0", () => {
      const lowStats: ColumnSummary[] = [
        makeStats({ name: "glucose", mean: 80 }),
        makeStats({ name: "bmi", mean: 22 }),
        makeStats({ name: "age", mean: 25 }),
      ];
      const results = computeRiskFactors(pimaDataset, lowStats, "pima");
      expect(results[0].severity).toBe("minimal");
    });
  });
});
