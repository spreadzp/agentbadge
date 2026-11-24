// EPIC-262 (SLICE-262-34): diff computation — locate the (head, base)
// pair through the previous_hash chain and reuse the 262-12 engine.
// Read-time derivation: nothing is stored, the pair is re-resolved on
// every call so retention pruning surfaces as an honest chain_broken.
import type { ScanJob } from "../scan/types";
import { computeMoMDelta } from "../delta";
import type { IntelReport } from "../report/schema";
import type { IntelReportDiffBody } from "./types";

interface ReportedJob {
  job: ScanJob;
  report: IntelReport;
}

/** Latest report-bearing job = head; base = the stored report whose
 *  content_hash the head chains to (NOT merely "second newest" — a
 *  base is proven by hash, never by position). */
export function selectDiffPair(jobs: ScanJob[]): {
  head: ReportedJob | null;
  base: ReportedJob | null;
  chainBroken: boolean;
} {
  const reported = jobs
    .filter((j): j is ScanJob & { report: IntelReport } => j.report !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((job) => ({ job, report: job.report }));
  const head = reported[0] ?? null;
  if (!head) return { head: null, base: null, chainBroken: false };
  const prevHash = head.report.previous_hash;
  if (prevHash === null) return { head, base: null, chainBroken: false };
  const base = reported.find(
    (r) => r.report.integrity.content_hash === prevHash,
  );
  return { head, base: base ?? null, chainBroken: !base };
}

export function computeReportDiff(
  jobs: ScanJob[],
  siteId: string,
  now: string,
): IntelReportDiffBody {
  const { head, base, chainBroken } = selectDiffPair(jobs);
  const empty = {
    new_findings: [] as string[],
    closed_findings: [] as string[],
    still_open: [] as string[],
    score_delta: { readiness: null, exposure: null },
  };
  const shell = {
    schema_version: "intel-report-diff/1" as const,
    site_id: siteId,
    generated_at: now,
    head_scores: null,
    ...empty,
  };
  if (!head) {
    return {
      ...shell,
      mode: "no_reports",
      ruleset_compatible: null,
      base_report_id: null,
      head_report_id: null,
      base_content_hash: null,
      head_content_hash: null,
      base_ruleset: null,
      head_ruleset: null,
    };
  }
  const headShell = {
    ...shell,
    head_report_id: head.report.report_id,
    head_content_hash: head.report.integrity.content_hash,
    head_ruleset: head.report.ruleset,
    head_scores: {
      readiness: head.report.scores.readiness.score,
      exposure: head.report.scores.exposure.score,
    },
  };
  if (chainBroken || !base) {
    return {
      ...headShell,
      mode: chainBroken ? "chain_broken" : "bootstrap",
      ruleset_compatible: null,
      base_report_id: null,
      base_content_hash: null,
      base_ruleset: null,
    };
  }
  const delta = computeMoMDelta(base.report, head.report);
  if (!delta) {
    // ruleset changed between the two reports — honest incompatibility,
    // NOT a fake-zero delta and NOT a silent pass (AC-2)
    return {
      ...headShell,
      mode: "diff",
      ruleset_compatible: false,
      base_report_id: base.report.report_id,
      base_content_hash: base.report.integrity.content_hash,
      base_ruleset: base.report.ruleset,
    };
  }
  return {
    ...headShell,
    mode: "diff",
    ruleset_compatible: true,
    base_report_id: base.report.report_id,
    base_content_hash: base.report.integrity.content_hash,
    base_ruleset: base.report.ruleset,
    new_findings: delta.newOpen,
    closed_findings: delta.closed,
    still_open: delta.stillOpen,
    score_delta: {
      readiness: delta.readinessDelta,
      exposure: delta.exposureDelta,
    },
  };
}
