import type { DemandOpportunityRecord } from "./types";
import { DEMAND_OPPORTUNITY_TRANSITIONS } from "./types";
import type { DemandStore } from "./store";
import type { MemoryDemandCore } from "./store-memory-core";
import { cloneEvent, cloneOpportunity } from "./store-memory-core";

/**
 * EPIC-231 (SLICE-231-1): opportunity + event ops for the
 * in-memory demand store — operator lifecycle transitions,
 * backlog linking (operator gesture only) and append-only events.
 */

type OpportunityOps = Pick<
  DemandStore,
  | "getOpportunity"
  | "listOpportunities"
  | "createOpportunity"
  | "transitionOpportunity"
  | "updateOpportunity"
  | "linkBacklogTask"
>;

export function memoryOpportunityOps(
  core: MemoryDemandCore,
): OpportunityOps {
  const {
    clusters,
    opportunities,
    now,
    appendEventsMem,
    transition,
  } = core;

  return {
    async getOpportunity(id) {
      const row = opportunities.get(id);
      return row ? cloneOpportunity(row) : null;
    },

    async listOpportunities(opts) {
      let out = [...opportunities.values()];
      if (opts?.status) out = out.filter((o) => o.status === opts.status);
      if (opts?.clusterId)
        out = out.filter((o) => o.clusterId === opts.clusterId);
      out.sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt < b.createdAt
            ? 1
            : -1,
      );
      const off = Math.max(0, opts?.offset ?? 0);
      const lim = Math.min(opts?.limit ?? 100, 1000);
      return out.slice(off, off + lim).map(cloneOpportunity);
    },

    async createOpportunity(input, evts) {
      if (!clusters.has(input.clusterId)) {
        return { record: null, created: false };
      }
      const ts = now();
      const record: DemandOpportunityRecord = {
        id: input.id,
        clusterId: input.clusterId,
        status: "PROPOSED",
        title: input.title,
        hypothesis: input.hypothesis ?? null,
        expectedValue: input.expectedValue ?? null,
        metricsSnapshot: input.metricsSnapshot ?? null,
        backlogTaskId: null,
        declineReason: null,
        createdBy: input.createdBy,
        createdAt: ts,
        updatedAt: ts,
        closedAt: null,
      };
      opportunities.set(record.id, record);
      appendEventsMem("opportunity", record.id, evts);
      return { record: cloneOpportunity(record), created: true };
    },

    async transitionOpportunity(id, input, event) {
      const p = input.patch ?? {};
      const out = transition(
        opportunities,
        id,
        input,
        DEMAND_OPPORTUNITY_TRANSITIONS,
        (row, nowIso) => {
          const next = { ...row };
          if (
            input.to === "DECLINED" ||
            input.to === "SHIPPED" ||
            input.to === "CLOSED"
          ) {
            next.closedAt = nowIso;
          }
          if (p.title !== undefined) next.title = p.title;
          if (p.hypothesis !== undefined) next.hypothesis = p.hypothesis;
          if (p.expectedValue !== undefined)
            next.expectedValue = p.expectedValue;
          if (p.declineReason !== undefined)
            next.declineReason = p.declineReason;
          return next;
        },
      );
      if (!out.ok) {
        return {
          record: out.record ? cloneOpportunity(out.record) : null,
          event: null,
          transitioned: false,
          reason: out.reason,
        };
      }
      const appended = appendEventsMem("opportunity", id, [event]);
      return {
        record: cloneOpportunity(out.record),
        event: cloneEvent(appended[0]!),
        transitioned: true,
      };
    },

    async updateOpportunity(id, patch, expected, event) {
      const cur = opportunities.get(id) ?? null;
      if (!cur) return { record: null, event: null, transitioned: false, reason: "missing" };
      if (cur.status !== expected.status) {
        return { record: cloneOpportunity(cur), event: null, transitioned: false, reason: "status_mismatch" };
      }
      const next: DemandOpportunityRecord = { ...cur, updatedAt: now() };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.hypothesis !== undefined) next.hypothesis = patch.hypothesis;
      if (patch.expectedValue !== undefined) next.expectedValue = patch.expectedValue;
      if (patch.declineReason !== undefined) next.declineReason = patch.declineReason;
      opportunities.set(id, next);
      const appended = appendEventsMem("opportunity", id, [event]);
      return {
        record: cloneOpportunity(next),
        event: cloneEvent(appended[0]!),
        transitioned: true,
      };
    },

    async linkBacklogTask(id, backlogTaskId, expected, event) {
      const cur = opportunities.get(id) ?? null;
      if (!cur) return { linked: false, reason: "missing" };
      if (cur.backlogTaskId !== null) {
        return { linked: false, reason: "already_linked" };
      }
      if (cur.status !== expected.status) {
        return { linked: false, reason: "status_mismatch" };
      }
      const next: DemandOpportunityRecord = {
        ...cur,
        status: "LINKED",
        backlogTaskId,
        updatedAt: now(),
      };
      opportunities.set(id, next);
      appendEventsMem("opportunity", id, [event]);
      return { linked: true, record: cloneOpportunity(next) };
    },
  };
}

type EventOps = Pick<DemandStore, "appendEvents" | "listEvents">;

export function memoryEventOps(core: MemoryDemandCore): EventOps {
  const {
    signals,
    clusters,
    opportunities,
    eventsOf,
    appendEventsMem,
    isEntityType,
  } = core;

  return {
    async appendEvents(entityType, entityId, evts) {
      if (!isEntityType(entityType)) {
        throw new Error(`appendEvents: unknown entityType ${entityType}`);
      }
      const parent =
        entityType === "signal"
          ? signals.has(entityId)
          : entityType === "cluster"
            ? clusters.has(entityId)
            : opportunities.has(entityId);
      if (!parent) return [];
      // idempotencyKey replay — return stored events for the keys.
      const keys = evts
        .map((e) => e.idempotencyKey)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        const replayed = eventsOf(entityType, entityId).filter(
          (e) => e.idempotencyKey && keys.includes(e.idempotencyKey),
        );
        if (replayed.length === keys.length && replayed.length > 0) {
          return replayed.map(cloneEvent);
        }
      }
      return appendEventsMem(entityType, entityId, evts).map(cloneEvent);
    },

    async listEvents(entityType, entityId, opts) {
      const out = eventsOf(entityType, entityId)
        .filter((e) => !opts?.visibility || e.visibility === opts.visibility)
        .map(cloneEvent);
      return out;
    },
  };
}
