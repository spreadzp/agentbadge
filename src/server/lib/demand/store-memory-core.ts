import type {
  DemandClusterRecord,
  DemandEventRecord,
  DemandOpportunityRecord,
  DemandSignalRecord,
} from "./types";
import { DEMAND_LEVEL_RANK } from "./types";
import type { DemandEventInput } from "./store";

/**
 * EPIC-231 (SLICE-231-1): shared memory-state + closure helpers for
 * the in-memory demand store (extracted to keep store-memory.ts
 * under max-lines). All helpers close over the same maps, so the
 * op-builders behave exactly like one synchronous tx body.
 */

export interface DemandMemoryData {
  signals: Map<string, DemandSignalRecord>;
  clusters: Map<string, DemandClusterRecord>;
  opportunities: Map<string, DemandOpportunityRecord>;
  /** `${entityType}:${entityId}` → ordered event log. */
  events: Map<string, DemandEventRecord[]>;
}

export function createMemoryDemandData(): DemandMemoryData {
  return {
    signals: new Map(),
    clusters: new Map(),
    opportunities: new Map(),
    events: new Map(),
  };
}

export const cloneSignal = (r: DemandSignalRecord): DemandSignalRecord => ({
  ...r,
});
export const cloneCluster = (r: DemandClusterRecord): DemandClusterRecord => ({
  ...r,
  levelBreakdown: { ...r.levelBreakdown },
});
export const cloneOpportunity = (
  r: DemandOpportunityRecord,
): DemandOpportunityRecord => ({ ...r });
export const cloneEvent = (e: DemandEventRecord): DemandEventRecord => ({
  ...e,
});

const idemKey = (scope: string, key: string) => `${scope}\u0000${key}`;
const logKey = (entityType: string, entityId: string) =>
  `${entityType}\u0000${entityId}`;

const ENTITY_TABLES: ReadonlySet<string> = new Set([
  "signal",
  "cluster",
  "opportunity",
]);

export function createMemoryDemandCore(data: DemandMemoryData) {
  const { signals, clusters, opportunities, events } = data;
  // Secondary indexes — idempotency + dedupeKey probes must not be
  // O(store) scans on an unauthenticated path (Arc 230-8 M14).
  const byIdem = new Map<string, DemandSignalRecord>();
  const byDedupeKey = new Map<string, DemandSignalRecord[]>();
  const byClusterKey = new Map<string, DemandClusterRecord>();
  const now = () => new Date().toISOString();

  const eventsOf = (entityType: string, entityId: string) =>
    events.get(logKey(entityType, entityId)) ?? [];

  const appendEventsMem = (
    entityType: string,
    entityId: string,
    evts: DemandEventInput[],
  ): DemandEventRecord[] => {
    if (evts.length === 0) return [];
    const key = logKey(entityType, entityId);
    const log = events.get(key) ?? [];
    let seq = log.reduce((m, e) => Math.max(m, e.seq), 0);
    const out: DemandEventRecord[] = [];
    for (const e of evts) {
      seq += 1;
      const rec: DemandEventRecord = {
        id: e.id ?? crypto.randomUUID(),
        entityType,
        entityId,
        seq,
        kind: e.kind,
        visibility: e.visibility,
        payload: e.payload,
        idempotencyKey: e.idempotencyKey ?? null,
        createdAt: now(),
      };
      log.push(rec);
      out.push(rec);
    }
    events.set(key, log);
    return out;
  };

  /** Full canonical-only recount + monotone level — the memory
   *  twin of recountClusterTx (serialized by the sync body). */
  const recountCluster = (
    clusterId: string,
    opts?: { promotedLevel?: string },
  ): DemandClusterRecord => {
    const cluster = clusters.get(clusterId)!;
    const canonical = [...signals.values()].filter(
      (s) => s.clusterId === clusterId && s.relatedSignalId === null,
    );
    const actors = new Set(
      canonical.map((s) => `${s.actorResolution}\u0000${s.actorRef ?? ""}`),
    );
    const levelBreakdown: Record<string, number> = {};
    for (const s of canonical) {
      levelBreakdown[s.level] = (levelBreakdown[s.level] ?? 0) + 1;
    }
    const promoted = opts?.promotedLevel;
    const nextLevel =
      promoted &&
      (DEMAND_LEVEL_RANK[promoted as keyof typeof DEMAND_LEVEL_RANK] ?? 0) >
        (DEMAND_LEVEL_RANK[cluster.level as keyof typeof DEMAND_LEVEL_RANK] ??
          0)
        ? promoted
        : cluster.level;
    const fresh: DemandClusterRecord = {
      ...cluster,
      count: canonical.length,
      uniqueActors: actors.size,
      levelBreakdown,
      level: nextLevel,
      lastSeenAt: now(),
      updatedAt: now(),
    };
    clusters.set(clusterId, fresh);
    byClusterKey.set(fresh.clusterKey, fresh);
    return fresh;
  };

  const upsertCluster = (seed: {
    clusterKey: string;
    category?: string | null;
    feature?: string | null;
    capabilityKey?: string | null;
    level: string;
  }): DemandClusterRecord => {
    const existing = byClusterKey.get(seed.clusterKey);
    if (existing) return existing;
    const ts = now();
    const cluster: DemandClusterRecord = {
      id: crypto.randomUUID(),
      clusterKey: seed.clusterKey,
      category: seed.category ?? null,
      feature: seed.feature ?? null,
      capabilityKey: seed.capabilityKey ?? null,
      count: 0,
      uniqueActors: 0,
      levelBreakdown: {},
      level: seed.level,
      status: "OPEN",
      firstSeenAt: ts,
      lastSeenAt: ts,
      updatedAt: ts,
    };
    clusters.set(cluster.id, cluster);
    byClusterKey.set(cluster.clusterKey, cluster);
    return cluster;
  };

  const transition = <R extends { id: string; status: string }>(
    rows: Map<string, R>,
    id: string,
    input: { from: string; to: string; now?: string },
    transitions: Readonly<Record<string, ReadonlySet<string>>>,
    effects?: (row: R, now: string) => R,
  ):
    | { record: R | null; ok: false; reason: "missing" | "status_mismatch" | "illegal" }
    | { record: R; ok: true } => {
    const cur = rows.get(id) ?? null;
    if (!cur) return { record: null, ok: false, reason: "missing" };
    if (cur.status !== input.from) {
      return { record: cur, ok: false, reason: "status_mismatch" };
    }
    if (transitions[input.from]?.has(input.to) !== true) {
      return { record: cur, ok: false, reason: "illegal" };
    }
    const nowIso = input.now ?? now();
    const next = effects
      ? effects({ ...cur, status: input.to, updatedAt: nowIso } as R, nowIso)
      : ({ ...cur, status: input.to, updatedAt: nowIso } as R);
    rows.set(id, next);
    return { record: next, ok: true };
  };

  return {
    signals,
    clusters,
    opportunities,
    events,
    byIdem,
    byDedupeKey,
    byClusterKey,
    now,
    eventsOf,
    appendEventsMem,
    recountCluster,
    upsertCluster,
    transition,
    idemKey,
    isEntityType: (t: string) => ENTITY_TABLES.has(t),
  };
}

export type MemoryDemandCore = ReturnType<typeof createMemoryDemandCore>;
