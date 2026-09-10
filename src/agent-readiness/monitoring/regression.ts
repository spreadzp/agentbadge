/**
 * SLICE-99-5: Regression engine — pure diff function.
 *
 * detectRegressions(prev, now, history, thresholds) → RegressionReport | null
 *
 * 6 rules per spec §10.3:
 * 1. score_drop: prev.score - now.score ≥ thresholds.score_drop
 * 2. new_gap: gap_id in now but not in prev, and NOT in history
 * 3. reopened_gap: gap_id in now but not in prev, AND in history (seen before)
 * 4. status_flip: rule VERIFIED|INFERRED in prev, GAP|CONFLICT in now
 * 5. new_conflict: rule CONFLICT in now, not CONFLICT in prev
 * 6. asr_drop: both have asr, prev.asr - now.asr ≥ thresholds.asr_drop
 *
 * Severity mapping (deterministic, no LLM):
 * - new_gap/reopened_gap with CRITICAL/HIGH priority → critical
 * - score_drop, status_flip, asr_drop → warning
 * - new_conflict, other new_gap/reopened_gap → info
 *
 * Noop: identical summaries → null (no report, no alert).
 * Error runs: diffs only between ok runs — error prev or now → null.
 *
 * Pure: no I/O, no clock, no LLM.
 */

import type {
  RunRecord,
  RegressionReport,
  RegressionItem,
  RegressionRuleType,
  Severity,
  Thresholds,
} from "./monitoring-types";

export const DEFAULT_THRESHOLDS: Thresholds = {
  score_drop: 5,
  asr_drop: 0.1,
  cooldown_hours: 24,
  min_severity: "warning",
};

export interface RegressionInput {
  prev: RunRecord;
  now: RunRecord;
  history: string[];
  thresholds: Thresholds;
}

/**
 * Extract gap_ids from a RunSummary.
 */
export function gapIdsFromSummary(summary: { gap_ids?: string[] }): string[] {
  return summary.gap_ids ?? [];
}

/**
 * Determine severity for a gap based on priority from the summary.
 */
function gapSeverity(gap_id: string, summary: { gap_summary: { by_priority: Record<string, number> } }): Severity {
  // If any CRITICAL or HIGH gaps exist, a new/reopened gap is potentially critical
  // In a real implementation, we'd have per-gap priority; here we use summary-level
  const bp = summary.gap_summary.by_priority;
  if ((bp.CRITICAL ?? 0) > 0 || (bp.HIGH ?? 0) > 0) {
    return "critical";
  }
  return "info";
}

/**
 * Detect regressions between two runs.
 * Returns null if no regressions found (noop) or if either run has outcome=error.
 */
export function detectRegressions(input: RegressionInput): RegressionReport | null {
  const { prev, now, history, thresholds } = input;

  // Error-run diff policy: only diff ok vs ok
  if (prev.outcome !== "ok" || now.outcome !== "ok") {
    return null;
  }

  const prevSummary = prev.summary;
  const nowSummary = now.summary;
  const findings: RegressionItem[] = [];

  // 1. score_drop
  const scoreDrop = prevSummary.score - nowSummary.score;
  if (scoreDrop >= thresholds.score_drop) {
    findings.push({
      rule: "score_drop",
      severity: "warning",
      delta: { prev: prevSummary.score, curr: nowSummary.score, drop: scoreDrop },
    });
  }

  // 2 & 3. new_gap / reopened_gap
  const prevGapIds = new Set(gapIdsFromSummary(prevSummary));
  const nowGapIds = gapIdsFromSummary(nowSummary);
  const historySet = new Set(history);

  for (const gap_id of nowGapIds) {
    if (!prevGapIds.has(gap_id)) {
      if (historySet.has(gap_id)) {
        // reopened_gap
        findings.push({
          rule: "reopened_gap",
          severity: gapSeverity(gap_id, nowSummary),
          gap_id,
          delta: { gap_id, was: "previously seen", now: "reopened" },
        });
      } else {
        // new_gap
        findings.push({
          rule: "new_gap",
          severity: gapSeverity(gap_id, nowSummary),
          gap_id,
          delta: { gap_id, was: "absent", now: "present" },
        });
      }
    }
  }

  // 4. status_flip: VERIFIED|INFERRED in prev → GAP|CONFLICT in now
  const prevStatuses = prevSummary.rule_statuses ?? {};
  const nowStatuses = nowSummary.rule_statuses ?? {};
  const goodStatuses = new Set(["VERIFIED", "INFERRED"]);
  const badStatuses = new Set(["GAP", "CONFLICT"]);

  for (const rule_id of Object.keys(nowStatuses)) {
    const prevStatus = prevStatuses[rule_id];
    const nowStatus = nowStatuses[rule_id];
    if (prevStatus && goodStatuses.has(prevStatus) && badStatuses.has(nowStatus)) {
      // Don't double-count: CONFLICT is handled by new_conflict rule
      if (nowStatus === "CONFLICT") continue;
      findings.push({
        rule: "status_flip",
        severity: "warning",
        rule_id,
        delta: { prev: prevStatus, curr: nowStatus },
      });
    }
  }

  // 5. new_conflict: CONFLICT in now, not CONFLICT in prev
  for (const rule_id of Object.keys(nowStatuses)) {
    const prevStatus = prevStatuses[rule_id];
    const nowStatus = nowStatuses[rule_id];
    if (nowStatus === "CONFLICT" && prevStatus !== "CONFLICT") {
      findings.push({
        rule: "new_conflict",
        severity: "info",
        rule_id,
        delta: { prev: prevStatus ?? "absent", curr: "CONFLICT" },
      });
    }
  }

  // 6. asr_drop
  if (prevSummary.asr !== null && nowSummary.asr !== null) {
    const asrDrop = prevSummary.asr - nowSummary.asr;
    if (asrDrop >= thresholds.asr_drop) {
      findings.push({
        rule: "asr_drop",
        severity: "warning",
        delta: { prev: prevSummary.asr, curr: nowSummary.asr, drop: asrDrop },
      });
    }
  }

  // Noop: no findings → null
  if (findings.length === 0) {
    return null;
  }

  // Deterministic ordering: by rule type, then by gap_id/rule_id
  findings.sort((a, b) => {
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    const aId = a.gap_id ?? a.rule_id ?? "";
    const bId = b.gap_id ?? b.rule_id ?? "";
    return aId.localeCompare(bId);
  });

  return {
    project_id: now.project_id,
    run_id: now.run_id,
    findings,
  };
}
