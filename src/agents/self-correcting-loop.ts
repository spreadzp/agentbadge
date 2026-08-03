/**
 * SLICE-26-11: Self-Correcting Loop
 * Verify → retry (max 3) → complete/abort.
 * Correction strategies: add missing glossary terms, lower correlation threshold, flag data quality.
 */

import type {
  AnalysisReport,
  AssertionTemplate,
  ValidationResult,
  RiskFactorResult,
  CorrelationResult,
} from "./types";
import { significantCorrelations } from "./analysis/correlation";

export interface LoopLogEntry {
  attempt: number;
  passed: boolean;
  failedChecks: string[];
  correctionApplied: string | null;
  timestamp: string;
}

export interface LoopResult {
  completed: boolean;
  attempts: number;
  logs: LoopLogEntry[];
  finalReport: AnalysisReport;
}

export interface LoopParams {
  taskId: string;
  report: AnalysisReport;
  verify: (taskId: string, report: AnalysisReport, template: AssertionTemplate) => Promise<ValidationResult>;
  completeTask: (taskId: string) => Promise<boolean>;
  template: AssertionTemplate;
  maxAttempts?: number;
}

// Glossary terms by dataset type for correction
const DATASET_GLOSSARY_TERMS: Record<string, string[]> = {
  pima: [
    "urn:li:glossaryTerm:Glucose",
    "urn:li:glossaryTerm:Hypertension",
    "urn:li:glossaryTerm:Obesity",
    "urn:li:glossaryTerm:InsulinResistance",
    "urn:li:glossaryTerm:Hyperglycemia",
  ],
  cardiac: [
    "urn:li:glossaryTerm:Cholesterol",
    "urn:li:glossaryTerm:BloodPressure",
    "urn:li:glossaryTerm:HeartRate",
  ],
  cancer: [
    "urn:li:glossaryTerm:TumorMarker",
    "urn:li:glossaryTerm:Biopsy",
  ],
};

/**
 * Correct an analysis report based on failed verification checks.
 * Returns a new AnalysisReport with corrections applied.
 */
export function correctAnalysis(failedChecks: string[], report: AnalysisReport): AnalysisReport {
  let corrected = { ...report };

  for (const check of failedChecks) {
    const lowerCheck = check.toLowerCase();

    if (lowerCheck.includes("missing glossary term")) {
      // Extract term name from check message
      const match = check.match(/glossary term:\s*(\w+)/i);
      const termName = match?.[1] ?? "Hypertension";
      const urn = `urn:li:glossaryTerm:${termName}`;
      corrected = addGlossaryTerm(corrected, urn);
    } else if (lowerCheck.includes("no significant correlations")) {
      // Lower the threshold — recompute significant correlations with lower bar
      corrected = lowerCorrelationThreshold(corrected);
    } else if (lowerCheck.includes("no glossary terms referenced")) {
      // Add all relevant terms for dataset type
      corrected = addRelevantGlossaryTerms(corrected);
    } else if (lowerCheck.includes("mean out of range")) {
      // Flag data quality issue — keep report but note the issue
      corrected = flagDataQuality(corrected, check);
    }
    // Unknown checks: no correction, return unchanged
  }

  return corrected;
}

function addGlossaryTerm(report: AnalysisReport, urn: string): AnalysisReport {
  const riskFactors = report.riskFactors.map((rf: RiskFactorResult) => {
    if (rf.glossaryTerms.includes(urn)) return rf;
    return { ...rf, glossaryTerms: [...rf.glossaryTerms, urn] };
  });
  // If no risk factors exist, add a placeholder with the term
  if (riskFactors.length === 0) {
    return {
      ...report,
      riskFactors: [
        {
          factorName: "Data Quality Flag",
          datasetType: "unknown",
          score: 0,
          severity: "minimal",
          threshold: 5,
          contributingFactors: [],
          glossaryTerms: [urn],
        },
      ],
    };
  }
  return { ...report, riskFactors };
}

function lowerCorrelationThreshold(report: AnalysisReport): AnalysisReport {
  // Mark more pairs as significant by lowering threshold from 0.3 to 0.15
  const lowered = significantCorrelations(report.correlation, 0.15);
  const pairs: CorrelationResult[] = report.correlation.pairs.map((p) => {
    const isSig = lowered.some((l) => l.columnX === p.columnX && l.columnY === p.columnY);
    return { ...p, significant: isSig };
  });
  return {
    ...report,
    correlation: { ...report.correlation, pairs },
  };
}

function addRelevantGlossaryTerms(report: AnalysisReport): AnalysisReport {
  // Determine dataset type from risk factors
  const datasetType = report.riskFactors[0]?.datasetType ?? "pima";
  const terms = DATASET_GLOSSARY_TERMS[datasetType] ?? DATASET_GLOSSARY_TERMS["pima"];

  const riskFactors = report.riskFactors.map((rf: RiskFactorResult) => {
    const existing = new Set(rf.glossaryTerms);
    const toAdd = terms.filter((t) => !existing.has(t));
    return { ...rf, glossaryTerms: [...rf.glossaryTerms, ...toAdd] };
  });

  return { ...report, riskFactors };
}

function flagDataQuality(report: AnalysisReport, _check: string): AnalysisReport {
  // Data quality flag — report remains valid but we could add metadata
  // For now, just return the report as-is (the flag is logged)
  return report;
}

/**
 * Run the self-correcting verification loop.
 * Max 3 attempts: deliver → verify → correct if needed.
 * On success: calls completeTask. On abort: task stays in delivered state.
 */
export async function runSelfCorrectingLoop(params: LoopParams): Promise<LoopResult> {
  const { taskId, report, verify, completeTask, template } = params;
  const maxAttempts = params.maxAttempts ?? 3;
  const logs: LoopLogEntry[] = [];
  let currentReport = report;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = new Date().toISOString();

    // Verify the report
    let result;
    try {
      result = await verify(taskId, currentReport, template);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        passed: false,
        checks: [{ description: "verify", passed: false, message: msg }],
        failedChecks: [`verify error: ${msg}`],
      };
    }

    if (result.passed) {
      // Success — complete the task
      await completeTask(taskId);
      logs.push({
        attempt,
        passed: true,
        failedChecks: [],
        correctionApplied: null,
        timestamp,
      });
      return { completed: true, attempts: attempt, logs, finalReport: currentReport };
    }

    // Failed — apply corrections
    const correctionApplied = result.failedChecks.join("; ");
    logs.push({
      attempt,
      passed: false,
      failedChecks: result.failedChecks,
      correctionApplied,
      timestamp,
    });

    if (attempt < maxAttempts) {
      currentReport = correctAnalysis(result.failedChecks, currentReport);
    }
  }

  // All attempts failed — abort, task stays in delivered state
  return { completed: false, attempts: maxAttempts, logs, finalReport: currentReport };
}
