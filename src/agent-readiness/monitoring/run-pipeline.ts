/**
 * SLICE-99-4: Run pipeline + history timeline.
 *
 * executeMonitoredRun: calls scan, extracts summary, persists RunRecord.
 * summarizeScanResult: pure function — extracts RunSummary from ScanReport.
 * getTimeline: ordered run history query.
 *
 * The scan function is injected (scanFn) for testability.
 * In production, the real scanDomain + RuleEngine + formatScanReport is used.
 */

import { randomUUID } from "node:crypto";
import type { MonitoringStore } from "./monitoring-store";
import type { MonitoredProject, RunRecord, RunSummary } from "./monitoring-types";
import type { ScanReport, PillarReport } from "../report-formatter";

export interface RunPipelineDeps {
  store: MonitoringStore;
  now: () => Date;
  scanFn: (url: string) => Promise<ScanReport>;
}

/**
 * Pure function: extract RunSummary from a ScanReport.
 * No re-computation — just field mapping per spec §10.2.
 */
export function summarizeScanResult(report: ScanReport): RunSummary {
  const pillar_scores: Record<string, number> = {};
  for (const p of report.pillars) {
    pillar_scores[p.pillar] = p.score;
  }

  const status_counts: Record<string, number> = {
    verified: report.verified,
    missing: report.missing,
    not_applicable: report.not_applicable,
    skipped: report.skipped,
  };

  return {
    score: report.score,
    grade: report.grade,
    pillar_scores,
    gap_summary: {
      total: report.gap_summary.total,
      by_priority: { ...report.gap_summary.by_priority },
      by_type: { ...report.gap_summary.by_type },
    },
    status_counts,
    asr: report.runtime?.asr?.rate ?? null,
  };
}

/**
 * Execute a monitored run for a project.
 * Calls scan, extracts summary, persists RunRecord, updates gap-history.
 */
export async function executeMonitoredRun(
  project: MonitoredProject,
  trigger: "scheduled" | "manual",
  deps: RunPipelineDeps,
): Promise<RunRecord> {
  const now = deps.now();
  const run_id = randomUUID();
  const started_at = now.toISOString();

  let outcome: "ok" | "error" = "ok";
  let summary: RunSummary;
  let report_ref: string;

  try {
    const report = await deps.scanFn(project.url);
    summary = summarizeScanResult(report);
    report_ref = `${project.project_id}/${run_id}`;

    // Update gap-history with current gap_ids (only on ok runs)
    if (report.gaps && report.gaps.length > 0) {
      for (const gap of report.gaps) {
        if (gap.gap_id) {
          deps.store.addToGapHistory(project.project_id, gap.gap_id);
        }
      }
    }
  } catch (err) {
    outcome = "error";
    const msg = err instanceof Error ? err.message : String(err);
    summary = {
      score: 0,
      grade: "F",
      pillar_scores: {},
      gap_summary: { total: 0, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 } },
      status_counts: {},
      asr: null,
    };
    report_ref = `${project.project_id}/${run_id}`;
  }

  const finished_at = deps.now().toISOString();

  const record: RunRecord = {
    run_id,
    project_id: project.project_id,
    started_at,
    finished_at,
    trigger,
    outcome,
    summary,
    report_ref,
  };

  deps.store.appendRun(record);
  return record;
}

/**
 * Get timeline of run summaries for a project, newest first.
 */
export function getTimeline(
  store: MonitoringStore,
  project_id: string,
  limit?: number,
): RunRecord[] {
  const runs = store.getLatestRuns(project_id, limit ?? 100);
  return runs; // already newest first from getLatestRuns
}
