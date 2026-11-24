import type { DemandSignalRecord } from "./types";
import type { DemandStore } from "./store";
import type { MemoryDemandCore } from "./store-memory-core";
import { cloneCluster, cloneSignal } from "./store-memory-core";

/**
 * EPIC-231 (SLICE-231-1): signal + cluster ops for the in-memory
 * demand store — same dedup rules, canonical-only recount and
 * append-only events as the Postgres adapter (cluster ops live
 * in store-memory-clusters.ts).
 */

type SignalOps = Pick<
  DemandStore,
  | "getSignal"
  | "findSignalByIdempotency"
  | "listSignals"
  | "recordSignal"
  | "retagSignal"
>;

export function memorySignalOps(core: MemoryDemandCore): SignalOps {
  const {
    signals,
    clusters,
    byIdem,
    byDedupeKey,
    now,
    appendEventsMem,
    recountCluster,
    upsertCluster,
    idemKey,
  } = core;

  return {
    async getSignal(id) {
      const row = signals.get(id);
      return row ? cloneSignal(row) : null;
    },

    async findSignalByIdempotency(idempotencyKey, dedupeScope) {
      const row = byIdem.get(idemKey(dedupeScope, idempotencyKey));
      return row ? cloneSignal(row) : null;
    },

    async listSignals(opts) {
      let out = [...signals.values()];
      if (opts?.clusterId)
        out = out.filter((s) => s.clusterId === opts.clusterId);
      if (opts?.source) out = out.filter((s) => s.source === opts.source);
      if (opts?.level) out = out.filter((s) => s.level === opts.level);
      if (opts?.actorRef)
        out = out.filter((s) => s.actorRef === opts.actorRef);
      if (opts?.canonicalOnly)
        out = out.filter((s) => s.relatedSignalId === null);
      out.sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt < b.createdAt
            ? 1
            : -1,
      );
      const off = Math.max(0, opts?.offset ?? 0);
      const lim = Math.min(opts?.limit ?? 100, 1000);
      return out.slice(off, off + lim).map(cloneSignal);
    },

    async recordSignal(input, clusterKey, evts) {
      if (input.idempotencyKey) {
        const existing = byIdem.get(
          idemKey(input.dedupeScope, input.idempotencyKey),
        );
        if (existing) {
          const cluster = existing.clusterId
            ? clusters.get(existing.clusterId)!
            : null;
          if (cluster) {
            return {
              signal: cloneSignal(existing),
              cluster: cloneCluster(cluster),
              canonicalOf: existing.relatedSignalId,
              duplicate: true,
            };
          }
        }
      }
      // Burst-dedup: earliest canonical row sharing dedupeKey.
      const canonical = (byDedupeKey.get(input.dedupeKey) ?? [])
        .filter((s) => s.relatedSignalId === null)
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.id.localeCompare(b.id)
            : a.createdAt < b.createdAt
              ? -1
              : 1,
        )[0];

      const cluster = upsertCluster({
        clusterKey,
        category: input.category,
        feature: input.feature,
        capabilityKey: input.capabilityKey,
        level: input.level,
      });
      const signal: DemandSignalRecord = {
        id: input.id,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        dedupeScope: input.dedupeScope,
        idempotencyKey: input.idempotencyKey ?? null,
        normalizedText: input.normalizedText,
        context: input.context ?? null,
        contextRetainUntil: input.contextRetainUntil ?? null,
        category: input.category ?? null,
        feature: input.feature ?? null,
        capabilityKey: input.capabilityKey ?? null,
        declaredLevel: input.declaredLevel,
        level: input.level,
        actorResolution: input.actorResolution,
        actorRef: input.actorRef ?? null,
        sessionId: input.sessionId ?? null,
        dedupeKey: input.dedupeKey,
        relatedCount: 1,
        relatedSignalId: canonical?.id ?? null,
        clusterId: canonical ? canonical.clusterId : cluster.id,
        createdAtMs: Math.trunc(input.createdAtMs),
        createdAt: now(),
      };
      signals.set(signal.id, signal);
      if (input.idempotencyKey) {
        byIdem.set(idemKey(input.dedupeScope, input.idempotencyKey), signal);
      }
      const dk = byDedupeKey.get(input.dedupeKey) ?? [];
      dk.push(signal);
      byDedupeKey.set(input.dedupeKey, dk);
      if (canonical) {
        canonical.relatedCount += 1;
        signals.set(canonical.id, canonical);
      }
      const fresh = recountCluster(cluster.id, {
        promotedLevel: input.level,
      });
      appendEventsMem("signal", signal.id, evts?.signal ?? []);
      appendEventsMem("cluster", cluster.id, evts?.cluster ?? []);
      return {
        signal: cloneSignal(signal),
        cluster: cloneCluster(fresh),
        canonicalOf: canonical?.id ?? null,
        duplicate: false,
      };
    },

    async retagSignal(id, patch, evts) {
      const cur = signals.get(id) ?? null;
      if (!cur) return { signal: null, cluster: null, detached: "missing" };
      if (cur.relatedSignalId !== null) {
        const cluster = cur.clusterId
          ? clusters.get(cur.clusterId) ?? null
          : null;
        return {
          signal: cloneSignal(cur),
          cluster: cluster ? cloneCluster(cluster) : null,
          detached: "linked_row",
        };
      }
      const target = upsertCluster({
        clusterKey: patch.clusterKey,
        category: patch.category,
        feature: patch.feature,
        capabilityKey: patch.capabilityKey,
        level: cur.level,
      });
      const sourceClusterId = cur.clusterId;
      const next: DemandSignalRecord = {
        ...cur,
        category: patch.category ?? null,
        feature: patch.feature ?? null,
        capabilityKey: patch.capabilityKey ?? null,
        clusterId: target.id,
      };
      signals.set(id, next);
      if (sourceClusterId && sourceClusterId !== target.id) {
        recountCluster(sourceClusterId, {});
      }
      const fresh = recountCluster(target.id, {});
      appendEventsMem("signal", id, evts?.signal ?? []);
      appendEventsMem("cluster", target.id, evts?.cluster ?? []);
      return {
        signal: cloneSignal(next),
        cluster: cloneCluster(fresh),
        detached: "ok",
      };
    },
  };
}
