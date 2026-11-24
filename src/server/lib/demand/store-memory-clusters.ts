import type { DemandClusterRecord } from "./types";
import { DEMAND_CLUSTER_TRANSITIONS } from "./types";
import type { DemandStore } from "./store";
import type { MemoryDemandCore } from "./store-memory-core";
import { cloneCluster, cloneEvent } from "./store-memory-core";

/**
 * EPIC-231 (SLICE-231-1): cluster ops for the in-memory demand
 * store — monotone level + status transitions, memory twin of the
 * Postgres adapter.
 */

type ClusterOps = Pick<
  DemandStore,
  | "getCluster"
  | "getClusterByKey"
  | "listClusters"
  | "applyClusterLevel"
  | "transitionCluster"
>;

export function memoryClusterOps(core: MemoryDemandCore): ClusterOps {
  const {
    clusters,
    byClusterKey,
    now,
    appendEventsMem,
    transition,
  } = core;

  return {
    async getCluster(id) {
      const row = clusters.get(id);
      return row ? cloneCluster(row) : null;
    },

    async getClusterByKey(clusterKey) {
      const row = byClusterKey.get(clusterKey);
      return row ? cloneCluster(row) : null;
    },

    async listClusters(opts) {
      let out = [...clusters.values()];
      if (opts?.status) out = out.filter((c) => c.status === opts.status);
      if (opts?.level) out = out.filter((c) => c.level === opts.level);
      const key =
        opts?.sortBy === "uniqueActors"
          ? "uniqueActors"
          : opts?.sortBy === "lastSeenAt"
            ? "lastSeenAt"
            : "count";
      out.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av === bv) return a.id.localeCompare(b.id);
        return av < bv ? 1 : -1;
      });
      const off = Math.max(0, opts?.offset ?? 0);
      const lim = Math.min(opts?.limit ?? 100, 1000);
      return out.slice(off, off + lim).map(cloneCluster);
    },

    async applyClusterLevel(id, input, event) {
      const cur = clusters.get(id) ?? null;
      if (!cur) {
        return {
          record: null,
          event: null,
          transitioned: false,
          reason: "missing",
        };
      }
      if (cur.level !== input.from) {
        return {
          record: cloneCluster(cur),
          event: null,
          transitioned: false,
          reason: "status_mismatch",
        };
      }
      const next: DemandClusterRecord = {
        ...cur,
        level: input.to,
        updatedAt: now(),
      };
      clusters.set(id, next);
      byClusterKey.set(next.clusterKey, next);
      const appended = appendEventsMem("cluster", id, [event]);
      return {
        record: cloneCluster(next),
        event: cloneEvent(appended[0]!),
        transitioned: true,
      };
    },

    async transitionCluster(id, input, event) {
      const out = transition(
        clusters,
        id,
        input,
        DEMAND_CLUSTER_TRANSITIONS,
      );
      if (!out.ok) {
        return {
          record: out.record ? cloneCluster(out.record) : null,
          event: null,
          transitioned: false,
          reason: out.reason,
        };
      }
      byClusterKey.set(out.record.clusterKey, out.record);
      const appended = appendEventsMem("cluster", id, [event]);
      return {
        record: cloneCluster(out.record),
        event: cloneEvent(appended[0]!),
        transitioned: true,
      };
    },
  };
}
