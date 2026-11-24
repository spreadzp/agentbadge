import type {
  DemandRepository,
  DemandEventInput as RepoEventInput,
} from "@agentbadge/database";

import type { DemandEventInput } from "./store";
import type {
  DemandClusterRecord,
  DemandEventRecord,
  DemandOpportunityRecord,
  DemandSignalRecord,
} from "./types";

/**
 * EPIC-231 (SLICE-231-1): row → domain-record mappers for the
 * Postgres adapter (extracted to keep store-db.ts under max-lines).
 * The interface never leaks Models.* types; createdAtMs narrows
 * BigInt → number at the boundary.
 */

export type SignalRow = NonNullable<
  Awaited<ReturnType<DemandRepository["getSignal"]>>
>;
export type ClusterRow = NonNullable<
  Awaited<ReturnType<DemandRepository["getCluster"]>>
>;
export type OpportunityRow = NonNullable<
  Awaited<ReturnType<DemandRepository["getOpportunity"]>>
>;
export type EventRow = Awaited<
  ReturnType<DemandRepository["listEvents"]>
>[number];

export const toSignal = (r: SignalRow): DemandSignalRecord => ({
  id: r.id,
  source: r.source,
  sourceRef: r.sourceRef,
  dedupeScope: r.dedupeScope,
  idempotencyKey: r.idempotencyKey,
  normalizedText: r.normalizedText,
  context: r.context,
  contextRetainUntil: r.contextRetainUntil,
  category: r.category,
  feature: r.feature,
  capabilityKey: r.capabilityKey,
  declaredLevel: r.declaredLevel,
  level: r.level,
  actorResolution: r.actorResolution,
  actorRef: r.actorRef,
  sessionId: r.sessionId,
  dedupeKey: r.dedupeKey,
  relatedCount: r.relatedCount,
  relatedSignalId: r.relatedSignalId,
  clusterId: r.clusterId,
  createdAtMs: Number(r.createdAtMs),
  createdAt: r.createdAt,
});

export const toCluster = (r: ClusterRow): DemandClusterRecord => ({
  id: r.id,
  clusterKey: r.clusterKey,
  category: r.category,
  feature: r.feature,
  capabilityKey: r.capabilityKey,
  count: r.count,
  uniqueActors: r.uniqueActors,
  levelBreakdown: (r.levelBreakdown ?? {}) as Record<string, number>,
  level: r.level,
  status: r.status,
  firstSeenAt: r.firstSeenAt,
  lastSeenAt: r.lastSeenAt,
  updatedAt: r.updatedAt,
});

export const toOpportunity = (
  r: OpportunityRow,
): DemandOpportunityRecord => ({
  id: r.id,
  clusterId: r.clusterId,
  status: r.status,
  title: r.title,
  hypothesis: r.hypothesis,
  expectedValue: r.expectedValue,
  metricsSnapshot: (r.metricsSnapshot ?? null) as Record<
    string,
    unknown
  > | null,
  backlogTaskId: r.backlogTaskId,
  declineReason: r.declineReason,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  closedAt: r.closedAt,
});

export const toEvent = (r: EventRow): DemandEventRecord => ({
  id: r.id,
  entityType: r.entityType,
  entityId: r.entityId,
  seq: r.seq,
  kind: r.kind,
  visibility: r.visibility,
  payload: r.payload as unknown,
  idempotencyKey: r.idempotencyKey,
  createdAt: r.createdAt,
});

export const repoEvent = (e: DemandEventInput): RepoEventInput => ({
  id: e.id,
  kind: e.kind,
  visibility: e.visibility,
  payload: e.payload as RepoEventInput["payload"],
  idempotencyKey: e.idempotencyKey ?? null,
});

export const repoEvents = (events: DemandEventInput[]): RepoEventInput[] =>
  events.map(repoEvent);
