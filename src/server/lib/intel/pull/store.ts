// EPIC-262 (SLICE-262-16): pull-job + security-event store contracts.
import type { IntelSecurityEvent, PullJob } from "./types";

export interface IntelPullJobStore {
  backend?: string;
  insert(j: PullJob): Promise<PullJob>;
  byId(id: string): Promise<PullJob | null>;
  update(j: PullJob): Promise<PullJob>;
  /** pending for peek: queued + claimed (still inside TTL) */
  pendingForSite(siteId: string, nowIso: string): Promise<PullJob[]>;
  /**
   * Atomic queued→claimed transition: succeeds ONLY when the stored
   * row is still `queued` (or already `claimed` in the SAME
   * generation → retry returns that context). Implementations MUST
   * be atomic — memory via synchronous map, PG via conditional
   * UPDATE ... WHERE status='queued' RETURNING.
   */
  claimAtomic(
    id: string,
    siteId: string,
    claim: {
      leaseToken: string;
      leaseExpiresAt: string;
      claimedAt: string;
    },
  ): Promise<
    | { ok: true; job: PullJob; retry: boolean }
    | { ok: false; reason: "missing" | "site_mismatch" | "not_queued" | "expired_ttl" }
  >;
  /** Requeue a claimed job whose lease expired without a result:
   *  status→queued (reclaim+1) or →expired when reclaims exhausted. */
  releaseExpiredLease(j: PullJob, nowIso: string): PullJob;
}

export interface IntelSecurityEventStore {
  backend?: string;
  append(e: IntelSecurityEvent): Promise<IntelSecurityEvent>;
  forSite(siteId: string): Promise<IntelSecurityEvent[]>;
}
