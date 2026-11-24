// EPIC-262 (SLICE-262-37): db-first pull-job + security-event store
// selection (same pick convention as scan/registry). Adapter narrows
// the package's loose record types at the boundary (status: string →
// PullJobStatus union; params/sig/result: unknown → typed).
import type { Database } from "@agentbadge/database";
import {
  createMemoryPullJobStore,
  createMemorySecurityEventStore,
} from "./memory";
import type { IntelPullJobStore, IntelSecurityEventStore } from "./store";
import type {
  IntelSecurityEvent,
  PullJob,
  PullJobStatus,
  SecurityEventType,
} from "./types";
import { PULL_PROTOCOL_LIMITS } from "./registry";
import type { CapabilityProbeId } from "./registry";

interface PullJobRepoRecord {
  id: string;
  siteId: string;
  tenantId: string;
  probeId: string;
  params: unknown;
  nonce: string;
  exp: string;
  keyId: string;
  sig: unknown;
  status: string;
  leaseGeneration: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  reclaimCount: number;
  result: unknown | null;
  resultEnvelopeId: string | null;
  scanId: string | null;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

interface SecurityEventRepoRecord {
  id: string;
  siteId: string;
  jobId: string | null;
  leaseGeneration: number | null;
  eventType: string;
  principal: string;
  correlationId: string | null;
  payloadDigest: string | null;
  createdAt: string;
}

export interface PullJobRepository {
  insert(j: PullJobRepoRecord): Promise<PullJobRepoRecord>;
  byId(id: string): Promise<PullJobRepoRecord | null>;
  update(j: PullJobRepoRecord): Promise<PullJobRepoRecord>;
  pendingForSite(
    siteId: string,
    nowIso: string,
  ): Promise<PullJobRepoRecord[]>;
  claimAtomic(
    id: string,
    siteId: string,
    claim: {
      leaseToken: string;
      leaseExpiresAt: string;
      claimedAt: string;
    },
  ): Promise<
    | { ok: true; job: PullJobRepoRecord; retry: boolean }
    | {
        ok: false;
        reason: "missing" | "site_mismatch" | "not_queued" | "expired_ttl";
      }
  >;
}

export interface SecurityEventRepository {
  append(e: SecurityEventRepoRecord): Promise<SecurityEventRepoRecord>;
  forSite(siteId: string): Promise<SecurityEventRepoRecord[]>;
}

const jobFrom = (r: PullJobRepoRecord): PullJob => ({
  ...r,
  probeId: r.probeId as CapabilityProbeId,
  params: (r.params ?? {}) as Record<string, unknown>,
  sig: r.sig as PullJob["sig"],
  status: r.status as PullJobStatus,
  result: (r.result ?? null) as Record<string, unknown> | null,
});

const jobTo = (j: PullJob): PullJobRepoRecord => ({ ...j });

const eventFrom = (r: SecurityEventRepoRecord): IntelSecurityEvent => ({
  ...r,
  eventType: r.eventType as SecurityEventType,
});

const adaptJobs = (repo: PullJobRepository): IntelPullJobStore => ({
  backend: "postgres",
  insert: async (j) => jobFrom(await repo.insert(jobTo(j))),
  byId: async (id) => {
    const r = await repo.byId(id);
    return r ? jobFrom(r) : null;
  },
  update: async (j) => jobFrom(await repo.update(jobTo(j))),
  pendingForSite: async (siteId, nowIso) =>
    (await repo.pendingForSite(siteId, nowIso)).map(jobFrom),
  claimAtomic: async (id, siteId, claim) => {
    const r = await repo.claimAtomic(id, siteId, claim);
    return r.ok ? { ok: true, job: jobFrom(r.job), retry: r.retry } : r;
  },
  releaseExpiredLease: (j, nowIso) => ({
    ...j,
    reclaimCount: j.reclaimCount + 1,
    status:
      j.reclaimCount + 1 > PULL_PROTOCOL_LIMITS.maxReclaims
        ? "expired"
        : "queued",
    leaseToken: null,
    leaseExpiresAt: null,
    updatedAt: nowIso,
  }),
});

const adaptEvents = (
  repo: SecurityEventRepository,
): IntelSecurityEventStore => ({
  backend: "postgres",
  append: async (e) => eventFrom(await repo.append({ ...e })),
  forSite: async (siteId) =>
    (await repo.forSite(siteId)).map(eventFrom),
});

let sharedJobs: IntelPullJobStore | undefined;
let sharedEvents: IntelSecurityEventStore | undefined;

export function pickIntelPullJobStore(
  db: Database | { intelPullJobs?: PullJobRepository | null },
): IntelPullJobStore {
  const repo = "intelPullJobs" in db ? db.intelPullJobs : undefined;
  if (repo) return adaptJobs(repo);
  return (sharedJobs ??= createMemoryPullJobStore());
}

export function pickIntelSecurityEventStore(
  db: Database | { intelSecurityEvents?: SecurityEventRepository | null },
): IntelSecurityEventStore {
  const repo = "intelSecurityEvents" in db ? db.intelSecurityEvents : undefined;
  if (repo) return adaptEvents(repo);
  return (sharedEvents ??= createMemorySecurityEventStore());
}
