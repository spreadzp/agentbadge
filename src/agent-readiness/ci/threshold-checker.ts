/**
 * SLICE-39-4: Score Threshold & Severity Check — Exit Codes
 */

import type { AgentReadinessReport } from "../integrity/report-serializer";

interface Assertion {
  rule_id: string;
  status: string;
  severity?: string;
  category?: string;
}

export interface ThresholdFailure {
  type: "score" | "severity";
  message: string;
  rule_id?: string;
}

export interface ThresholdResult {
  passed: boolean;
  exitCode: number;
  failures: ThresholdFailure[];
}

export function checkThresholds(
  report: AgentReadinessReport,
  minScore: number,
): ThresholdResult {
  const failures: ThresholdFailure[] = [];

  const score = report.score.overall ?? (report.score as Record<string, unknown>).total as number ?? 0;

  if (score < minScore) {
    failures.push({
      type: "score",
      message: `Score ${score} is below minimum threshold ${minScore}`,
    });
  }

  const assertions = report.assertions as Assertion[];
  for (const a of assertions) {
    if (a.severity === "high" && a.status !== "VERIFIED" && a.status !== "PASS") {
      failures.push({
        type: "severity",
        message: `High severity assertion ${a.rule_id} is not verified (status: ${a.status})`,
        rule_id: a.rule_id,
      });
    }
  }

  const passed = failures.length === 0;
  return {
    passed,
    exitCode: passed ? 0 : 2,
    failures,
  };
}
