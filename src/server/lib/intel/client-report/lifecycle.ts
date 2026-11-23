// EPIC-262 (SLICE-262-11): generation + lifecycle transitions +
// editorial versioning + delta computation (D-UX-Q4).

import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { IntelReport } from "../report";
import {
  diffRuleStatuses,
  ruleStatusMap,
  rulesetsCompatible,
  type FindingStatus,
} from "../delta";
import type { ScanJob } from "../scan";
import type {
  ClientReport,
  ClientReportCanonical,
  ClientReportDelta,
  ClientReportStatus,
  EditorialRevision,
} from "./types";

const now = () => new Date().toISOString();

/** canonical snapshot — extracted once, immutable thereafter */
export function snapshotCanonical(
  job: ScanJob,
  report: IntelReport,
): ClientReportCanonical {
  const counts = { pass: 0, fail: 0, warn: 0, unknown: 0 };
  const openRuleIds: string[] = [];
  for (const f of report.findings) {
    counts[f.status] += 1;
    if (f.status === "fail" || f.status === "warn") openRuleIds.push(f.rule_id);
  }
  return {
    reportId: report.report_id,
    scanId: report.scan.scan_id,
    contentHash: report.integrity.content_hash,
    keyId: report.integrity.signature.key_id,
    generatedAt: report.scan.generated_at,
    completeness: report.scan.completeness,
    ruleset: { name: report.ruleset.name, version: report.ruleset.version },
    scores: {
      readiness: report.scores.readiness.score,
      exposure: report.scores.exposure.score,
    },
    findingCounts: counts,
    openFindingRuleIds: openRuleIds.sort(),
    findingStatuses: ruleStatusMap(report),
    provenance: { ...report.evidence.provenance },
    envelopeCount: report.evidence.envelope_count,
  };
}

/** delta vs previous period — only when the previous report ran the
 *  same ruleset (score axes stay comparable). Otherwise null. */
export function computeDelta(
  prev: ClientReport | null,
  canonical: ClientReportCanonical,
): ClientReportDelta | null {
  if (!prev) return null;
  const p = prev.canonical;
  if (!rulesetsCompatible(p.ruleset, canonical.ruleset)) return null;
  // prefer the full status map when both sides carry it (262-12);
  // older rows fall back to open-id set math (no transitions)
  let newOpen: string[];
  let closed: string[];
  let stillOpen: string[] | undefined;
  let transitions: { rule_id: string; from: string; to: string }[] | undefined;
  if (p.findingStatuses && canonical.findingStatuses) {
    const diff = diffRuleStatuses(
      p.findingStatuses as Record<string, FindingStatus>,
      canonical.findingStatuses as Record<string, FindingStatus>,
    );
    newOpen = diff.newOpen;
    closed = diff.closed;
    stillOpen = diff.stillOpen;
    transitions = diff.transitions;
  } else {
    const prevOpen = new Set(p.openFindingRuleIds);
    const curOpen = new Set(canonical.openFindingRuleIds);
    newOpen = [...curOpen].filter((r) => !prevOpen.has(r)).sort();
    closed = [...prevOpen].filter((r) => !curOpen.has(r)).sort();
  }
  return {
    prevReportId: prev.id,
    readinessDelta:
      p.scores.readiness !== null && canonical.scores.readiness !== null
        ? canonical.scores.readiness - p.scores.readiness
        : null,
    exposureDelta:
      p.scores.exposure !== null && canonical.scores.exposure !== null
        ? canonical.scores.exposure - p.scores.exposure
        : null,
    newOpenRuleIds: newOpen,
    closedRuleIds: closed,
    stillOpenRuleIds: stillOpen,
    transitions,
  };
}

/** period key "YYYY-MM" from an ISO timestamp */
export const periodOf = (iso: string) => iso.slice(0, 7);

export function generateClientReport(input: {
  siteId: string;
  tenantId: string;
  job: ScanJob;
  period?: string; // default: report's own generated month
  prev: ClientReport | null;
  operatorId: string;
}): ClientReport {
  if (!input.job.report) throw new Error("job has no report");
  const canonical = snapshotCanonical(input.job, input.job.report);
  const ts = now();
  return {
    id: `cr_${generateReportId()}`,
    siteId: input.siteId,
    tenantId: input.tenantId,
    period: input.period ?? periodOf(canonical.generatedAt),
    status: "GENERATED",
    canonical,
    delta: computeDelta(input.prev, canonical),
    editorial: {
      version: 1,
      heroLine: "",
      whatChanged: "",
      nextMonth: "",
      internalNote: "",
      editedBy: input.operatorId,
      editedAt: ts,
    },
    editorialHistory: [],
    approvedBy: null,
    sentBy: null,
    sentAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** forward-only lifecycle — illegal transitions throw. */
const NEXT: Record<ClientReportStatus, ClientReportStatus | null> = {
  GENERATED: "IN_REVIEW",
  IN_REVIEW: "APPROVED",
  APPROVED: "SENT",
  SENT: null,
};

export function transition(
  r: ClientReport,
  to: ClientReportStatus,
  operatorId: string,
): ClientReport {
  if (NEXT[r.status] !== to)
    throw new Error(`illegal_transition:${r.status}->${to}`);
  const ts = now();
  const out: ClientReport = { ...r, status: to, updatedAt: ts };
  if (to === "APPROVED") out.approvedBy = operatorId;
  if (to === "SENT") {
    out.sentBy = operatorId;
    out.sentAt = ts;
  }
  return out;
}

/** editorial edit — bumps version, archives the previous revision.
 *  Canonical half is never touched; SENT reports are frozen. */
export function editEditorial(
  r: ClientReport,
  fields: Pick<EditorialRevision, "heroLine" | "whatChanged" | "nextMonth" | "internalNote">,
  operatorId: string,
): ClientReport {
  if (r.status === "SENT") throw new Error("report_sent");
  const next: EditorialRevision = {
    ...fields,
    version: r.editorial.version + 1,
    editedBy: operatorId,
    editedAt: now(),
  };
  return {
    ...r,
    editorial: next,
    editorialHistory: [...r.editorialHistory, r.editorial],
    updatedAt: now(),
  };
}
