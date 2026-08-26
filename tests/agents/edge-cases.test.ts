/**
 * SLICE-26-13: Edge case tests
 */

import { describe, it, expect } from "vitest";
import { runAnalysisPipeline } from "../../src/agents/analysis/pipeline";
import { correctAnalysis } from "../../src/agents/self-correcting-loop";
import { runSelfCorrectingLoop } from "../../src/agents/self-correcting-loop";
import {
  mockEmptyDataset,
  mockSingleRowDataset,
  mockAllNullDataset,
  mockNonNumericInNumericColumn,
  mockPimaDataset,
} from "./helpers/mock-data";
import type { AssertionTemplate } from "../../src/agents/types";

const TEMPLATE: AssertionTemplate = {
  analysisType: "descriptive",
  description: "Edge case assertions",
  requiredGlossaryTerms: [],
  assertions: [{ type: "schema", description: "Basic schema" }],
};

describe("Edge case: Empty dataset (0 rows)", () => {
  it("handles empty dataset without throwing", () => {
    const ds = mockEmptyDataset();
    const report = runAnalysisPipeline(ds, "Empty Dataset", "pima");
    expect(report.descriptive.length).toBe(2); // still has column summaries
    expect(report.correlation.pairs.length).toBe(1); // 1 pair for 2 columns
  });
});

describe("Edge case: Single row dataset", () => {
  it("handles single row without throwing", () => {
    const ds = mockSingleRowDataset();
    const report = runAnalysisPipeline(ds, "Single Row", "pima");
    expect(report.descriptive.length).toBe(3);
    // Single row: stdDev should be 0, min === max
    const glucose = report.descriptive.find((d) => d.name === "glucose");
    expect(glucose).toBeDefined();
    if (glucose) {
      expect(glucose.stdDev).toBe(0);
    }
  });
});

describe("Edge case: All-null column", () => {
  it("handles all-null column with null stats", () => {
    const ds = mockAllNullDataset();
    const report = runAnalysisPipeline(ds, "All Null", "pima");
    const glucose = report.descriptive.find((d) => d.name === "glucose");
    expect(glucose).toBeDefined();
    if (glucose) {
      expect(glucose.nullCount).toBe(3);
      expect(glucose.mean).toBeNull();
    }
  });
});

describe("Edge case: Non-numeric data in numeric column", () => {
  it("handles non-numeric values gracefully", () => {
    const ds = mockNonNumericInNumericColumn();
    // Should not throw — non-numeric values treated as null or filtered
    expect(() => runAnalysisPipeline(ds, "Mixed Types", "pima")).not.toThrow();
  });
});

describe("Edge case: Self-correcting loop with timeout simulation", () => {
  it("handles verifier timeout (rejects) → abort after 3 attempts", async () => {
    const ds = mockPimaDataset(10);
    const report = runAnalysisPipeline(ds, "Timeout Test", "pima");

    const result = await runSelfCorrectingLoop({
      taskId: "task-timeout",
      report,
      template: TEMPLATE,
      verify: async () => {
        throw new Error("verifier timeout");
      },
      completeTask: async () => true,
      maxAttempts: 3,
    });

    // Should abort due to errors
    expect(result.completed).toBe(false);
    expect(result.attempts).toBe(3);
  });
});

describe("Edge case: correctAnalysis with multiple failures", () => {
  it("applies multiple corrections in sequence", () => {
    const ds = mockPimaDataset(10);
    const report = runAnalysisPipeline(ds, "Multi-Correction", "pima");
    const corrected = correctAnalysis(
      ["no glossary terms referenced", "no significant correlations"],
      report,
    );
    // Should have glossary terms added
    const hasTerms = corrected.riskFactors.some((rf) => rf.glossaryTerms.length > 0);
    expect(hasTerms).toBe(true);
  });
});
