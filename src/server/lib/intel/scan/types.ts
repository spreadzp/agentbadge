// EPIC-262 (SLICE-262-6): hosted deep-scan job — the external scan is
// OUR observation from outside (EXTERNAL_OBSERVED), triggered per
// site under entitlement. Job states mirror EXPLAINED §3: a report is
// produced only from a completed scan; PARTIAL stays visible.
import type { IntelReport } from "../report";

export const SCAN_JOB_STATUSES = [
  "queued",
  "running",
  "complete",
  "partial",
  "failed",
] as const;
export type ScanJobStatus = (typeof SCAN_JOB_STATUSES)[number];

export interface ScanJob {
  id: string; // job_<ulid>
  siteId: string;
  tenantId: string;
  /** scan_<ulid> — shared with the envelopes and the report it feeds */
  scanId: string;
  /** SLICE-262-31 — X-Request-Id of the triggering request (null for
   *  jobs created outside a request context); support correlation */
  correlationId: string | null;
  status: ScanJobStatus;
  baseUrl: string; // https://<primary-hostname>
  /** probe transport failures seen while running */
  probeFailures: number;
  probeTotal: number;
  error: string | null;
  reportId: string | null;
  /** the signed canonical report — persisted verbatim (v1 lives on
   *  the job row; a dedicated report surface can index it later) */
  report: IntelReport | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  finishedAt: string | null; // ISO
}
