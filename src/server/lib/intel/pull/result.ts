// EPIC-262 (SLICE-262-16): pull-job result submit — the write path
// where every trust decision lands: generation binding, consent
// re-check, idempotent replay vs conflict, result → envelope
// PLUGIN_SELF_REPORTED (ADR §1/§3/§7, gates G1).
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import { acceptSubmission } from "../evidence";
import { computeDedupeHash } from "../evidence/store";
import { hasActiveConsent } from "../consent";
import { validateResultShape } from "./registry";
import type { PullJob } from "./types";
import { intelPullJobsTotal } from "../metrics";
import {
  digestOf,
  nowIso,
  securityEvent,
  type PullDeps,
} from "./ops";

export type ResultOutcome =
  | { ok: true; job: PullJob; envelopeId: string; deduplicated: boolean }
  | { ok: false; http: 400 | 403 | 404 | 409; reason: string };

export async function submitPullResult(
  deps: PullDeps,
  id: string,
  siteId: string,
  body: { lease_token?: unknown; result?: unknown },
  principal: string,
): Promise<ResultOutcome> {
  const j = await deps.pullJobs.byId(id);
  if (!j || j.siteId !== siteId)
    return { ok: false, http: 404, reason: "job_unknown" };

  const result = body.result as Record<string, unknown> | undefined;
  const incomingDigest = digestOf(result ?? null);

  // ── done-job path: idempotent replay vs conflict (D-262-Q36, R1) ──
  if (j.status === "done") {
    if (
      canonicalizeJson(j.result as never) === canonicalizeJson(result as never)
    ) {
      return {
        ok: true,
        job: j,
        envelopeId: j.resultEnvelopeId ?? "",
        deduplicated: true,
      };
    }
    await securityEvent(deps, {
      siteId,
      jobId: j.id,
      leaseGeneration: j.leaseGeneration,
      eventType: "result_conflict",
      principal,
      correlationId: j.correlationId,
      payloadDigest: incomingDigest,
    });
    intelPullJobsTotal.labels("result_conflict").inc();
    return { ok: false, http: 409, reason: "conflict" };
  }

  if (j.status === "expired" || j.status === "failed") {
    return { ok: false, http: 409, reason: `job_${j.status}` };
  }
  const now = nowIso(deps);
  if (j.exp <= now) return { ok: false, http: 409, reason: "job_expired_ttl" };

  // ── stale lease / generation binding (gate G1) ──
  if (j.status !== "claimed") {
    return { ok: false, http: 409, reason: "not_claimed" };
  }
  if (typeof body.lease_token !== "string" || body.lease_token !== j.leaseToken) {
    await securityEvent(deps, {
      siteId,
      jobId: j.id,
      leaseGeneration: j.leaseGeneration,
      eventType: "lease_stale",
      principal,
      correlationId: j.correlationId,
      payloadDigest: incomingDigest,
    });
    intelPullJobsTotal.labels("lease_stale").inc();
    return { ok: false, http: 409, reason: "lease_expired" };
  }
  if (j.leaseExpiresAt !== null && j.leaseExpiresAt <= now) {
    // lease ran out mid-flight → requeue for a fresh executor
    await deps.pullJobs.update(deps.pullJobs.releaseExpiredLease(j, now));
    await securityEvent(deps, {
      siteId,
      jobId: j.id,
      leaseGeneration: j.leaseGeneration,
      eventType: "lease_stale",
      principal,
      correlationId: j.correlationId,
      payloadDigest: incomingDigest,
    });
    intelPullJobsTotal.labels("lease_stale").inc();
    return { ok: false, http: 409, reason: "lease_expired" };
  }

  // ── consent re-check at submit (mid-flight revocation, ADR §4) ──
  if (!(await hasActiveConsent(deps.consent, siteId, "inside_diagnostics"))) {
    return { ok: false, http: 403, reason: "consent_denied" };
  }

  if (!validateResultShape(j.probeId, result).ok) {
    return { ok: false, http: 400, reason: "result_invalid" };
  }

  // ── result → envelope PLUGIN_SELF_REPORTED (same boundary as
  //    self-report: collector id is channel-derived) ──
  const collectedAt = now;
  const submission = resultToSubmission(j, result!, collectedAt, siteId);
  const dedupeHash = computeDedupeHash(submission, siteId);
  const dup = await deps.evidence.byDedupeHash(dedupeHash);
  let envelopeId: string;
  if (dup) {
    envelopeId = dup.id;
  } else {
    const envelope = acceptSubmission(
      submission,
      {
        collector: {
          type: "wp_plugin",
          id: `wp_plugin@${siteId}`,
          version: "pull-v1",
        },
        site_id: siteId,
      },
      deps.signKey,
    );
    const days = deps.evidenceRetentionDays ?? 0;
    await deps.evidence.insert({
      id: envelope.envelope_id,
      schemaVersion: envelope.schema_version,
      siteId,
      scanId: envelope.scan_id,
      collectorId: `wp_plugin@${siteId}`,
      provenance: envelope.provenance,
      dedupeHash,
      receivedAt: envelope.received_at,
      expiresAt:
        days > 0
          ? new Date(
              Date.parse(envelope.received_at) + days * 86_400_000,
            ).toISOString()
          : null,
      envelope,
    });
    envelopeId = envelope.envelope_id;
  }

  const done: PullJob = {
    ...j,
    status: "done",
    result: result!,
    resultEnvelopeId: envelopeId,
    completedAt: now,
    updatedAt: now,
  };
  intelPullJobsTotal.labels("result_accepted").inc();
  return {
    ok: true,
    job: await deps.pullJobs.update(done),
    envelopeId,
    deduplicated: false,
  };
}

/** Pull result → CollectorSubmission reusing the self-report shapes:
 *  const_read/option_read → wp_option_read (feeds the SAME rule
 *  facts as 262-14 self-report — X-009 and co.); phpinfo_summary →
 *  site subject + wp_option_read{name:"phpinfo_summary"}. */
function resultToSubmission(
  j: PullJob,
  result: Record<string, unknown>,
  collectedAt: string,
  siteId: string,
) {
  const name =
    j.probeId === "phpinfo_summary"
      ? "phpinfo_summary"
      : String(result.name ?? j.params.name ?? j.probeId);
  const value =
    j.probeId === "const_read"
      ? result.defined === true
        ? (result.value ?? true)
        : false
      : j.probeId === "option_read"
        ? result.present === true
          ? (result.value ?? null)
          : null
        : result;
  return {
    collector_id: `wp_plugin@${siteId}`,
    scan_id: j.scanId ?? `pull-${j.id}`,
    site_ref: siteId,
    collected_at: collectedAt,
    subject:
      j.probeId === "phpinfo_summary"
        ? ({ type: "site" } as const)
        : ({ type: "wp_option", name } as const),
    payload: {
      type: "wp_option_read" as const,
      name,
      value,
    },
    evidence_refs: [],
  };
}
