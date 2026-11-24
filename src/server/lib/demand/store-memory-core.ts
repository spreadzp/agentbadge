import type {
  DemandClusterRecord,
  DemandEventRecord,
  DemandOpportunityRecord,
  DemandSignalRecord,
} from "./types";
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

/** O3 read-side retention (Arc 231 R1 M8): verbatim `context` is
 *  nulled past contextRetainUntil on every READ — the janitor that
 *  physically clears the column is future work, but no surface may
 *  expose retained text past its horizon. */
export const redactSignalContext = (
  r: DemandSignalRecord,
  nowIso = new Date().toISOString(),
): DemandSignalRecord =>
  r.context !== null && r.contextRetainUntil !== null && r.contextRetainUntil < nowIso
    ? { ...r, context: null }
    : r;
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
  // Arc 231 R1 H3: indexes hold signal IDS, not row objects — a
  // retag replaces the row (signals.set(id, next)) and any index
  // still pointing at the old object would silently resurrect it.
  const byIdem = new Map<string, string>();
  const byDedupeKey = new Map<string, string[]>();
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

  /** Full canonical-only recount — the memory twin of
   *  recountClusterTx (serialized by the sync body). Level is NOT
   *  touched: it moves only via applyClusterLevel (floors or
   *  operator), never from signal volume (Arc 231 R1 H1). */
  const recountCluster = (clusterId: string): DemandClusterRecord => {
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
    const fresh: DemandClusterRecord = {
      ...cluster,
      count: canonical.length,
      uniqueActors: actors.size,
      levelBreakdown,
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
      // Arc 231 R1 H1: seed INTEREST — a caller's declaredLevel is
      // informational on the signal, never the cluster's level.
      level: "INTEREST",
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
