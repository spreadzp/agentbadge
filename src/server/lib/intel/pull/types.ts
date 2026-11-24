// EPIC-262 (SLICE-262-16): pull-job types per ADR-INTEL-002 + spec
// pull-protocol v1. The job's SIGNED body is {job_id, site_id,
// probe_id, params, exp, nonce, key_id} — lifecycle fields (status,
// lease generation) sit outside the signature, never inside it.
import type { CapabilityProbeId } from "./registry";

export const PULL_JOB_STATUSES = [
  "queued",
  "claimed",
  "done",
  "expired",
  "failed",
] as const;
export type PullJobStatus = (typeof PULL_JOB_STATUSES)[number];

export interface PullJob {
  id: string; // pjob_<ulid>
  siteId: string;
  tenantId: string;
  probeId: CapabilityProbeId;
  /** typed params — whitelisted names only, ≤1KiB JSON */
  params: Record<string, unknown>;
  /** one-time nonce — replay binding */
  nonce: string;
  /** ISO — job execution deadline (TTL 60min from create) */
  exp: string;
  /** jobs signing key id referenced inside the signature */
  keyId: string;
  sig: { algorithm: "ed25519"; value: string };
  status: PullJobStatus;
  /** monotonically increasing claim generation — result accepted
   *  ONLY from the current generation (D-262-Q32) */
  leaseGeneration: number;
  /** opaque token tying result to this generation */
  leaseToken: string | null;
  leaseExpiresAt: string | null; // ISO, claim +15min
  reclaimCount: number;
  /** accepted result payload (verbatim, canonical-compared) */
  result: Record<string, unknown> | null;
  /** env_<ulid> of the envelope minted for the accepted result */
  resultEnvelopeId: string | null;
  /** scan_<ulid> when created by a /scans bounded-wait run */
  scanId: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  claimedAt: string | null;
  completedAt: string | null;
}

/** Peek row returned to the plugin — signed body + lifecycle, no
 *  secrets (params are whitelisted names only). */
export interface PullJobPeek {
  job_id: string;
  site_id: string;
  probe_id: CapabilityProbeId;
  params: Record<string, unknown>;
  nonce: string;
  exp: string;
  key_id: string;
  sig: { algorithm: "ed25519"; value: string };
  status: PullJobStatus;
  lease_generation: number;
  lease_expires_at: string | null;
  created_at: string;
}

export const SECURITY_EVENT_TYPES = [
  "result_conflict",
  "lease_stale",
  "job_forge_rejected",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Append-only security event (R3-Q4) — separate from consent audit;
 *  NEVER stores the full conflicting payload — digest only. Recorded
 *  regardless of active consent. */
export interface IntelSecurityEvent {
  id: string; // sev_<ulid>
  siteId: string;
  jobId: string | null;
  leaseGeneration: number | null;
  eventType: SecurityEventType;
  /** authenticated principal: site:<site_id> | operator:<id> */
  principal: string;
  correlationId: string | null;
  /** sha256 hex of canonical rejected body — comparison without data */
  payloadDigest: string | null;
  createdAt: string; // ISO
}
