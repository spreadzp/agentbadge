// EPIC-262 (SLICE-262-28): attestation lifecycle ops — issue from a
// completed scan job, revoke with reason (idempotent).
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import type { IntelReport } from "../report/schema";
import type { ScanJob } from "../scan/types";
import type { IntelAttestationStore } from "./store";
import { signAttestation } from "./sign";
import type { IntelAttestation } from "./types";

export const ATTESTATION_VALIDITY_DAYS_DEFAULT = 90;
const DAY_MS = 86_400_000;

export type IssueResult =
  | { ok: true; attestation: IntelAttestation }
  | { ok: false; reason: "no_report" | "site_mismatch" | "no_tenant" };

/** Issue an attestation for a scan job's signed report. The job's
 *  siteId/tenantId are trusted (already tenant-checked upstream). */
export async function issueAttestation(
  store: IntelAttestationStore,
  job: ScanJob,
  key: SigningKey,
  validityDays = ATTESTATION_VALIDITY_DAYS_DEFAULT,
  now = new Date(),
): Promise<IssueResult> {
  const report: IntelReport | null = job.report;
  if (!report) return { ok: false, reason: "no_report" };
  if (report.site_id !== job.siteId) return { ok: false, reason: "site_mismatch" };
  if (!job.tenantId) return { ok: false, reason: "no_tenant" };

  const issued = now.toISOString();
  const body: Omit<IntelAttestation, "signature"> = {
    schema_version: "intel-attestation/1",
    attestation_id: `att_${generateReportId()}`,
    site_id: job.siteId,
    tenant_id: job.tenantId,
    report_id: report.report_id,
    scan_id: job.scanId,
    ruleset: report.ruleset,
    scores: {
      readiness: {
        score: report.scores.readiness.score,
        evaluable: report.scores.readiness.evaluable,
        fail: report.scores.readiness.fail,
      },
      exposure: {
        score: report.scores.exposure.score,
        evaluable: report.scores.exposure.evaluable,
        fail: report.scores.exposure.fail,
      },
    },
    content_hash: report.integrity.content_hash,
    issued,
    valid_until: new Date(now.getTime() + validityDays * DAY_MS).toISOString(),
    status: "active",
    revoked_at: null,
    revoked_reason: null,
  };
  const attestation = signAttestation(body, key);
  await store.insert(attestation);
  return { ok: true, attestation };
}

export type RevokeResult =
  | { ok: true; attestation: IntelAttestation; alreadyRevoked?: boolean }
  | { ok: false; reason: "missing" };

/** Revoke is idempotent — a second revoke returns the same record
 *  with alreadyRevoked, never an error (retry-safe ops surface). */
export async function revokeAttestation(
  store: IntelAttestationStore,
  id: string,
  reason: string,
  now = new Date().toISOString(),
): Promise<RevokeResult> {
  const a = await store.byId(id);
  if (!a) return { ok: false, reason: "missing" };
  if (a.status === "revoked") return { ok: true, attestation: a, alreadyRevoked: true };
  const revoked: IntelAttestation = {
    ...a,
    status: "revoked",
    revoked_at: now,
    revoked_reason: reason.slice(0, 500),
  };
  await store.update(revoked);
  return { ok: true, attestation: revoked };
}
