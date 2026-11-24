import type { DemandSignalRecord } from "./types";
import type { DemandStore } from "./store";
import type { MemoryDemandCore } from "./store-memory-core";
import {
  cloneCluster,
  cloneSignal,
  redactSignalContext,
} from "./store-memory-core";

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
      return row ? redactSignalContext(cloneSignal(row)) : null;
    },

    async findSignalByIdempotency(idempotencyKey, dedupeScope) {
      const id = byIdem.get(idemKey(dedupeScope, idempotencyKey));
      const row = id ? signals.get(id) : undefined;
      return row ? redactSignalContext(cloneSignal(row)) : null;
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
      return out
        .slice(off, off + lim)
        .map((s) => redactSignalContext(cloneSignal(s)));
    },

    async recordSignal(input, clusterKey, evts) {
      if (input.idempotencyKey) {
        const existingId = byIdem.get(
          idemKey(input.dedupeScope, input.idempotencyKey),
        );
        const existing = existingId ? signals.get(existingId) : undefined;
        if (existing) {
          const cluster = existing.clusterId
            ? clusters.get(existing.clusterId)!
            : null;
          if (cluster) {
            return {
              signal: redactSignalContext(cloneSignal(existing)),
              cluster: cloneCluster(cluster),
              canonicalOf: existing.relatedSignalId,
              duplicate: true,
            };
          }
        }
      }
      // Burst-dedup: earliest canonical row sharing dedupeKey that is
      // still inside the rolling window (Arc 231 R1 M3 — a fixed
      // UTC-day bucket let one actor mint two canonicals per midnight).
      const canonical = (byDedupeKey.get(input.dedupeKey) ?? [])
        .map((id) => signals.get(id))
        .filter((s): s is DemandSignalRecord => s !== undefined)
        .filter((s) => s.relatedSignalId === null)
        .filter(
          (s) =>
            input.dedupeAfterMs === undefined ||
            input.dedupeAfterMs === null ||
            s.createdAtMs >= input.dedupeAfterMs,
        )
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.id.localeCompare(b.id)
            : a.createdAt < b.createdAt
              ? -1
              : 1,
        )[0];

      // Arc 231 R2 L-11: a burst-dup folds into its CANONICAL's
      // cluster — upserting by this request's own clusterKey would
      // mint a ghost cluster and recount/return the wrong one
      // (visible when the canonical was retagged into a dict key).
      const cluster = canonical?.clusterId
        ? (clusters.get(canonical.clusterId) ??
          upsertCluster({
            clusterKey,
            category: input.category,
            feature: input.feature,
            capabilityKey: input.capabilityKey,
          }))
        : upsertCluster({
            clusterKey,
            category: input.category,
            feature: input.feature,
            capabilityKey: input.capabilityKey,
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
        clusterId: cluster.id,
        createdAtMs: Math.trunc(input.createdAtMs),
        createdAt: now(),
      };
      signals.set(signal.id, signal);
      if (input.idempotencyKey) {
        byIdem.set(
          idemKey(input.dedupeScope, input.idempotencyKey),
          signal.id,
        );
      }
      const dk = byDedupeKey.get(input.dedupeKey) ?? [];
      dk.push(signal.id);
      byDedupeKey.set(input.dedupeKey, dk);
      if (canonical) {
        canonical.relatedCount += 1;
        signals.set(canonical.id, canonical);
      }
      const fresh = recountCluster(cluster.id);
      appendEventsMem("signal", signal.id, evts?.signal ?? []);
      appendEventsMem("cluster", cluster.id, evts?.cluster ?? []);
      return {
        signal: redactSignalContext(cloneSignal(signal)),
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
          signal: redactSignalContext(cloneSignal(cur)),
          cluster: cluster ? cloneCluster(cluster) : null,
          detached: "linked_row",
        };
      }
      const target = upsertCluster({
        clusterKey: patch.clusterKey,
        category: patch.category,
        feature: patch.feature,
        capabilityKey: patch.capabilityKey,
      });
      const sourceClusterId = cur.clusterId;
      const next: DemandSignalRecord = {
        ...cur,
        category: patch.category ?? null,
        feature: patch.feature ?? null,
        // Arc 231 R1 M9: absent ≠ clear — a category/feature retag
        // must not silently null the signal's capabilityKey.
        capabilityKey:
          patch.capabilityKey === undefined
            ? cur.capabilityKey
            : patch.capabilityKey,
        clusterId: target.id,
      };
      signals.set(id, next);
      if (sourceClusterId && sourceClusterId !== target.id) {
        recountCluster(sourceClusterId);
      }
      const fresh = recountCluster(target.id);
      appendEventsMem("signal", id, evts?.signal ?? []);
      appendEventsMem("cluster", target.id, evts?.cluster ?? []);
      return {
        signal: redactSignalContext(cloneSignal(next)),
        cluster: cloneCluster(fresh),
        detached: "ok",
      };
    },
  };
}
