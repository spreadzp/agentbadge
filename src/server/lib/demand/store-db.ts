import type { DemandRepository } from "@agentbadge/database";

import type {
  DemandStore,
  DemandTransitionResult,
} from "./store";
import type { DemandClusterRecord } from "./types";
import {
  repoEvent,
  repoEvents,
  toCluster,
  toEvent,
  toSignal,
} from "./store-db-mappers";
import { dbOpportunityOps } from "./store-db-opportunity";
import { redactSignalContext } from "./store-memory-core";

/**
 * EPIC-231 (SLICE-231-1): Postgres adapter — DemandRepository rows
 * → DemandStore domain records (feedback/store-db.ts precedent).
 * Row mappers live in store-db-mappers.ts (max-lines).
 */

export function createDbDemandStore(repo: DemandRepository): DemandStore {
  return {
    backend: "postgres",

    // ─── signals ──────────────────────────────────────────────

    async getSignal(id) {
      const row = await repo.getSignal(id);
      // O3 read-side retention (Arc 231 R1 M8): null context past
      // contextRetainUntil — mirrors the memory adapter.
      return row ? redactSignalContext(toSignal(row)) : null;
    },

    async findSignalByIdempotency(idempotencyKey, dedupeScope) {
      const row = await repo.findSignalByIdempotency(
        idempotencyKey,
        dedupeScope,
      );
      return row ? redactSignalContext(toSignal(row)) : null;
    },

    async listSignals(opts) {
      const rows = await repo.listSignals({
        clusterId: opts?.clusterId,
        source: opts?.source,
        level: opts?.level,
        actorRef: opts?.actorRef,
        canonicalOnly: opts?.canonicalOnly,
        limit: opts?.limit,
        offset: opts?.offset,
      });
      return rows.map((r) => redactSignalContext(toSignal(r)));
    },

    async recordSignal(input, clusterKey, events) {
      const out = await repo.recordSignal(
        {
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
          createdAtMs: input.createdAtMs,
          dedupeAfterMs: input.dedupeAfterMs ?? null,
        },
        clusterKey,
        events
          ? {
              signal: events.signal ? repoEvents(events.signal) : undefined,
              cluster: events.cluster ? repoEvents(events.cluster) : undefined,
            }
          : undefined,
      );
      return {
        signal: redactSignalContext(toSignal(out.signal)),
        cluster: toCluster(out.cluster),
        canonicalOf: out.canonicalOf,
        duplicate: out.duplicate,
      };
    },

    async retagSignal(id, patch, events) {
      const out = await repo.retagSignal(
        id,
        {
          clusterKey: patch.clusterKey,
          category: patch.category ?? null,
          feature: patch.feature ?? null,
          capabilityKey: patch.capabilityKey ?? null,
        },
        events
          ? {
              signal: events.signal ? repoEvents(events.signal) : undefined,
              cluster: events.cluster ? repoEvents(events.cluster) : undefined,
            }
          : undefined,
      );
      return {
        signal: out.signal ? redactSignalContext(toSignal(out.signal)) : null,
        cluster: out.cluster ? toCluster(out.cluster) : null,
        detached: out.detached,
      };
    },

    // ─── clusters ─────────────────────────────────────────────

    async getCluster(id) {
      const row = await repo.getCluster(id);
      return row ? toCluster(row) : null;
    },

    async getClusterByKey(clusterKey) {
      const row = await repo.getClusterByKey(clusterKey);
      return row ? toCluster(row) : null;
    },

    async listClusters(opts) {
      const rows = await repo.listClusters({
        status: opts?.status,
        level: opts?.level,
        sortBy: opts?.sortBy,
        limit: opts?.limit,
        offset: opts?.offset,
      });
      return rows.map(toCluster);
    },

    async applyClusterLevel(id, input, event): Promise<DemandTransitionResult<DemandClusterRecord>> {
      const out = await repo.applyClusterLevel(
        id,
        { from: input.from, to: input.to },
        repoEvent(event),
      );
      if (out.transitioned) {
        return {
          record: toCluster(out.row),
          event: toEvent(out.event),
          transitioned: true,
        };
      }
      return {
        record: out.row ? toCluster(out.row) : null,
        event: null,
        transitioned: false,
        reason: out.reason,
      };
    },

    async transitionCluster(id, input, event): Promise<DemandTransitionResult<DemandClusterRecord>> {
      const out = await repo.transitionCluster(
        id,
        {
          from: input.from,
          to: input.to,
          actor: input.actor,
          reason: input.reason ?? null,
          linkRef: input.linkRef ?? null,
          now: input.now,
        },
        repoEvent(event),
      );
      if (out.transitioned) {
        return {
          record: toCluster(out.row),
          event: toEvent(out.event),
          transitioned: true,
        };
      }
      return {
        record: out.row ? toCluster(out.row) : null,
        event: null,
        transitioned: false,
        reason: out.reason,
      };
    },

    // ─── opportunities (store-db-opportunity.ts — max-lines) ────

    ...dbOpportunityOps(repo),

    // ─── events ───────────────────────────────────────────────

    async appendEvents(entityType, entityId, events) {
      const rows = await repo.appendEvents(
        entityType,
        entityId,
        repoEvents(events),
      );
      return rows.map(toEvent);
    },

    async listEvents(entityType, entityId, opts) {
      const rows = await repo.listEvents(entityType, entityId, {
        visibility: opts?.visibility,
        limit: opts?.limit,
      });
      return rows.map(toEvent);
    },
  };
}
