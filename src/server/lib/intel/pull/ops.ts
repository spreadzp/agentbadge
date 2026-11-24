// EPIC-262 (SLICE-262-16): pull-job ops — create/peek/claim/result.
// Every trust decision lives HERE, backend-side: consent checked at
// claim AND at result-submit (mid-flight revocation works), lease
// generation binds result to the current executor, conflict → 409 +
// security event (ADR §1/§7, R1–R3).
import { createHash, randomBytes } from "node:crypto";
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import type { IntelEvidenceStore } from "../evidence/store";
import type { IntelConsentStore } from "../consent";
import { hasActiveConsent } from "../consent";
import type { CapabilityProbeId } from "./registry";
import { PULL_PROTOCOL_LIMITS, validateParams } from "./registry";
import { signJobBody, jobSignedBody } from "./sign";
import type { IntelPullJobStore, IntelSecurityEventStore } from "./store";
import {
  intelPullJobsTotal,
  intelSecurityEventsTotal,
} from "../metrics";
import type { PullJob, PullJobPeek } from "./types";

export interface PullDeps {
  pullJobs: IntelPullJobStore;
  securityEvents: IntelSecurityEventStore;
  evidence: IntelEvidenceStore;
  consent: IntelConsentStore;
  jobsKey: SigningKey; // derived intel:jobs sub-key
  signKey: SigningKey; // root intel key (envelope signing)
  evidenceRetentionDays?: number;
  now?: () => Date;
}

export const nowIso = (deps: PullDeps) =>
  (deps.now?.() ?? new Date()).toISOString();

const leaseToken = () => `lt_${randomBytes(16).toString("base64url")}`;
const nonce = () => `n_${randomBytes(16).toString("base64url")}`;

export async function securityEvent(
  deps: PullDeps,
  e: Omit<import("./types").IntelSecurityEvent, "id" | "createdAt">,
) {
  intelSecurityEventsTotal.labels(e.eventType).inc();
  return deps.securityEvents.append({
    ...e,
    id: `sev_${generateReportId()}`,
    createdAt: nowIso(deps),
  });
}

export const digestOf = (v: unknown) =>
  createHash("sha256")
    .update(canonicalizeJson(v as never))
    .digest("hex");

// ─── create ─────────────────────────────────────────────────────────

export async function createPullJob(
  deps: PullDeps,
  input: {
    siteId: string;
    tenantId: string;
    probeId: string;
    params: Record<string, unknown>;
    scanId?: string;
    /** SLICE-262-31 — X-Request-Id of the creating request */
    correlationId?: string;
  },
): Promise<{ ok: true; job: PullJob } | { ok: false; reason: string }> {
  const v = validateParams(input.probeId, input.params);
  if (!v.ok) return { ok: false, reason: "params_rejected" };
  const now = nowIso(deps);
  const exp = new Date(
    Date.parse(now) + PULL_PROTOCOL_LIMITS.jobTtlSeconds * 1000,
  ).toISOString();
  const unsigned: PullJob = {
    id: `pjob_${generateReportId()}`,
    siteId: input.siteId,
    tenantId: input.tenantId,
    probeId: input.probeId as CapabilityProbeId,
    params: v.params,
    nonce: nonce(),
    exp,
    keyId: deps.jobsKey.keyId,
    sig: { algorithm: "ed25519", value: "" },
    status: "queued",
    leaseGeneration: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    reclaimCount: 0,
    result: null,
    resultEnvelopeId: null,
    scanId: input.scanId ?? null,
    correlationId: input.correlationId ?? null,
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    completedAt: null,
  };
  unsigned.sig = signJobBody(jobSignedBody(unsigned), deps.jobsKey);
  intelPullJobsTotal.labels("created").inc();
  return { ok: true, job: await deps.pullJobs.insert(unsigned) };
}

// ─── peek (read-only) ───────────────────────────────────────────────

export async function peekPullJobs(
  deps: PullDeps,
  siteId: string,
): Promise<PullJobPeek[]> {
  const now = nowIso(deps);
  const pending = await deps.pullJobs.pendingForSite(siteId, now);
  return pending.map((j) => ({
    job_id: j.id,
    site_id: j.siteId,
    probe_id: j.probeId,
    params: j.params,
    nonce: j.nonce,
    exp: j.exp,
    key_id: j.keyId,
    sig: j.sig,
    status: j.status,
    lease_generation: j.leaseGeneration,
    lease_expires_at: j.leaseExpiresAt,
    created_at: j.createdAt,
  }));
}

// ─── claim ──────────────────────────────────────────────────────────

export type ClaimOutcome =
  | { ok: true; job: PullJob; retry: boolean }
  | { ok: false; reason: "missing" | "site_mismatch" | "not_queued" | "expired_ttl" | "consent_denied" };

export async function claimPullJob(
  deps: PullDeps,
  id: string,
  siteId: string,
): Promise<ClaimOutcome> {
  if (!(await hasActiveConsent(deps.consent, siteId, "inside_diagnostics"))) {
    return { ok: false, reason: "consent_denied" };
  }
  const now = nowIso(deps);
  // lease-expired claimed jobs requeue BEFORE the claim attempt —
  // the sweep is inside the write path, never inside peek.
  const existing = await deps.pullJobs.byId(id);
  if (
    existing &&
    existing.status === "claimed" &&
    existing.leaseExpiresAt !== null &&
    existing.leaseExpiresAt <= now
  ) {
    await deps.pullJobs.update(
      deps.pullJobs.releaseExpiredLease(existing, now),
    );
  }
  const r = await deps.pullJobs.claimAtomic(id, siteId, {
    leaseToken: leaseToken(),
    leaseExpiresAt: new Date(
      Date.parse(now) + PULL_PROTOCOL_LIMITS.leaseSeconds * 1000,
    ).toISOString(),
    claimedAt: now,
  });
  if (r.ok) intelPullJobsTotal.labels("claimed").inc();
  return r;
}
