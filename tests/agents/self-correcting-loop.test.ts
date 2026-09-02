import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  correctAnalysis,
  runSelfCorrectingLoop,
} from "../../src/agents/self-correcting-loop";
import { generatePimaSample } from "../../src/agents/analysis/pima-dataset";
import { runAnalysisPipeline } from "../../src/agents/analysis/pipeline";
import { significantCorrelations } from "../../src/agents/analysis/correlation";
import type { AnalysisReport, AssertionTemplate, ValidationResult, RiskFactorResult } from "../../src/agents/types";

function makeReport(): AnalysisReport {
  const ds = generatePimaSample();
  return runAnalysisPipeline(ds, "Pima Indians Diabetes", "pima");
}

const PASSING_VALIDATION: ValidationResult = {
  passed: true,
  checks: [{ description: "schema", passed: true, message: "all fields present" }],
  failedChecks: [],
};

function failingValidation(checks: string[]): ValidationResult {
  return {
    passed: false,
    checks: checks.map((c) => ({ description: c, passed: false, message: c })),
    failedChecks: checks,
  };
}

const TEMPLATE: AssertionTemplate = {
  analysisType: "descriptive",
  description: "Pima diabetes assertions",
  requiredGlossaryTerms: ["urn:li:glossaryTerm:Glucose"],
  assertions: [
    { type: "schema", description: "All fields present" },
    { type: "freshness", description: "Recent analysis", minGlossaryTerms: 1, minSignificantCorrelations: 1 },
  ],
};

// ─── correctAnalysis ───────────────────────────────────────────────

describe("correctAnalysis", () => {
  it("adds missing glossary term to risk factors", () => {
    const report = makeReport();
    const corrected = correctAnalysis(["missing glossary term: Hypertension"], report);
    expect(corrected.riskFactors.length).toBeGreaterThanOrEqual(report.riskFactors.length);
  });

  it("lowers correlation threshold when no significant correlations", () => {
    const report = makeReport();
    // Use a high threshold so no correlations are significant
    const sigHigh = significantCorrelations(report.correlation, 0.99);
    expect(sigHigh.length).toBe(0);
    const corrected = correctAnalysis(["no significant correlations"], report);
    // After correction, threshold lowered to 0.15 — check with 0.2 to see new significant ones
    const sigLowered = significantCorrelations(corrected.correlation, 0.2);
    expect(sigLowered.length).toBeGreaterThan(0);
  });

  it("adds glossary terms when none referenced", () => {
    const report = makeReport();
    const reportNoTerms: AnalysisReport = {
      ...report,
      riskFactors: report.riskFactors.map((rf: RiskFactorResult) => ({ ...rf, glossaryTerms: [] })),
    };
    const corrected = correctAnalysis(["no glossary terms referenced"], reportNoTerms);
    const hasTerms = corrected.riskFactors.some((rf: RiskFactorResult) => rf.glossaryTerms.length > 0);
    expect(hasTerms).toBe(true);
  });

  it("flags data quality issue when mean out of range", () => {
    const report = makeReport();
    const corrected = correctAnalysis(["mean out of range: glucose"], report);
    // Should add a note or flag — check that report is still valid
    expect(corrected.descriptive).toBeDefined();
    expect(corrected.descriptive.length).toBe(report.descriptive.length);
  });

  it("returns report unchanged for unknown failure", () => {
    const report = makeReport();
    const corrected = correctAnalysis(["unknown check: something weird"], report);
    expect(corrected).toEqual(report);
  });
});

// ─── runSelfCorrectingLoop ─────────────────────────────────────────

describe("runSelfCorrectingLoop", () => {
  it("passes on 1st attempt → completed, attempts=1", async () => {
    const verifyFn = vi.fn(() => Promise.resolve(PASSING_VALIDATION));
    const completeFn = vi.fn(() => Promise.resolve(true));

    const result = await runSelfCorrectingLoop({
      taskId: "task-1",
      report: makeReport(),
      verify: verifyFn,
      completeTask: completeFn,
      template: TEMPLATE,
      maxAttempts: 3,
    });

    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(verifyFn).toHaveBeenCalledTimes(1);
    expect(completeFn).toHaveBeenCalledTimes(1);
  });

  it("passes on 2nd attempt after correction → completed, attempts=2", async () => {
    let callCount = 0;
    const verifyFn = vi.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(failingValidation(["no glossary terms referenced"]));
      return Promise.resolve(PASSING_VALIDATION);
    });
    const completeFn = vi.fn(() => Promise.resolve(true));

    const result = await runSelfCorrectingLoop({
      taskId: "task-2",
      report: makeReport(),
      verify: verifyFn,
      completeTask: completeFn,
      template: TEMPLATE,
      maxAttempts: 3,
    });

    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(2);
    expect(verifyFn).toHaveBeenCalledTimes(2);
    expect(completeFn).toHaveBeenCalledTimes(1);
  });

  it("aborts after 3 failures → not completed, attempts=3", async () => {
    const verifyFn = vi.fn(() => Promise.resolve(failingValidation(["persistent failure"])));
    const completeFn = vi.fn(() => Promise.resolve(true));

    const result = await runSelfCorrectingLoop({
      taskId: "task-3",
      report: makeReport(),
      verify: verifyFn,
      completeTask: completeFn,
      template: TEMPLATE,
      maxAttempts: 3,
    });

    expect(result.completed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(verifyFn).toHaveBeenCalledTimes(3);
    expect(completeFn).toHaveBeenCalledTimes(0);
  });

  it("calls completeTask on success", async () => {
    const verifyFn = vi.fn(() => Promise.resolve(PASSING_VALIDATION));
    const completeFn = vi.fn(() => Promise.resolve(true));

    await runSelfCorrectingLoop({
      taskId: "task-complete",
      report: makeReport(),
      verify: verifyFn,
      completeTask: completeFn,
      template: TEMPLATE,
      maxAttempts: 3,
    });

    expect(completeFn).toHaveBeenCalledWith("task-complete");
  });

  it("does not call completeTask on abort", async () => {
    const verifyFn = vi.fn(() => Promise.resolve(failingValidation(["always fails"])));
    const completeFn = vi.fn(() => Promise.resolve(true));

    await runSelfCorrectingLoop({
      taskId: "task-abort",
      report: makeReport(),
      verify: verifyFn,
      completeTask: completeFn,
      template: TEMPLATE,
      maxAttempts: 3,
    });

    expect(completeFn).not.toHaveBeenCalled();
  });

  it("logs all attempts with failed checks and corrections", async () => {
    let callCount = 0;
    const verifyFn = vi.fn(() => {
      callCount++;
      if (callCount < 3) return Promise.resolve(failingValidation(["no glossary terms referenced"]));
      return Promise.resolve(PASSING_VALIDATION);
    });
    const completeFn = vi.fn(() => Promise.resolve(true));

    const result = await runSelfCorrectingLoop({
      taskId: "task-logs",
      report: makeReport(),
      verify: verifyFn,
      completeTask: completeFn,
      template: TEMPLATE,
      maxAttempts: 3,
    });

    expect(result.logs.length).toBe(3);
    expect(result.logs[0].attempt).toBe(1);
    expect(result.logs[0].passed).toBe(false);
    expect(result.logs[0].failedChecks).toContain("no glossary terms referenced");
    expect(result.logs[2].passed).toBe(true);
  });
});
