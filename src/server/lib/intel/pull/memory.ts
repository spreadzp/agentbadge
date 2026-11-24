// EPIC-262 (SLICE-262-16): in-memory pull-job + security-event stores.
import type {
  IntelPullJobStore,
  IntelSecurityEventStore,
} from "./store";
import type { IntelSecurityEvent, PullJob } from "./types";
import { PULL_PROTOCOL_LIMITS } from "./registry";

export function createMemoryPullJobStore(): IntelPullJobStore {
  const byId = new Map<string, PullJob>();
  return {
    backend: "memory",
    async insert(j) {
      byId.set(j.id, j);
      return j;
    },
    async byId(id) {
      return byId.get(id) ?? null;
    },
    async update(j) {
      byId.set(j.id, j);
      return j;
    },
    async pendingForSite(siteId, nowIso) {
      return [...byId.values()].filter(
        (j) =>
          j.siteId === siteId &&
          j.exp > nowIso &&
          (j.status === "queued" || j.status === "claimed"),
      );
    },
    async claimAtomic(id, siteId, claim) {
      // single-threaded map mutation = atomic for the memory backend
      const j = byId.get(id);
      if (!j) return { ok: false, reason: "missing" };
      if (j.siteId !== siteId) return { ok: false, reason: "site_mismatch" };
      if (j.exp <= claim.claimedAt) return { ok: false, reason: "expired_ttl" };
      if (
        j.status === "claimed" &&
        j.leaseExpiresAt !== null &&
        j.leaseExpiresAt > claim.claimedAt
      ) {
        // live claim by the same site's plugin → SAME lease context,
        // never a new generation (claim retry / lost response, R3).
        return { ok: true, job: j, retry: true };
      }
      if (j.status !== "queued") return { ok: false, reason: "not_queued" };
      const updated: PullJob = {
        ...j,
        status: "claimed",
        leaseGeneration: j.leaseGeneration + 1,
        leaseToken: claim.leaseToken,
        leaseExpiresAt: claim.leaseExpiresAt,
        claimedAt: claim.claimedAt,
        updatedAt: claim.claimedAt,
      };
      byId.set(id, updated);
      return { ok: true, job: updated, retry: false };
    },
    releaseExpiredLease(j, nowIso) {
      const next: PullJob = {
        ...j,
        reclaimCount: j.reclaimCount + 1,
        status:
          j.reclaimCount + 1 > PULL_PROTOCOL_LIMITS.maxReclaims
            ? "expired"
            : "queued",
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: nowIso,
      };
      byId.set(j.id, next);
      return next;
    },
  };
}

export function createMemorySecurityEventStore(): IntelSecurityEventStore {
  const rows: IntelSecurityEvent[] = [];
  return {
    backend: "memory",
    async append(e) {
      rows.push(e);
      return e;
    },
    async forSite(siteId) {
      return rows.filter((r) => r.siteId === siteId);
    },
  };
}
