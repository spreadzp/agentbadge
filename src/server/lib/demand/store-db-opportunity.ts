import type {
  DemandRepository,
  DemandEventInput as RepoEventInput,
} from "@agentbadge/database";

import type {
  DemandStore,
  DemandTransitionResult,
} from "./store";
import type { DemandOpportunityRecord } from "./types";
import {
  repoEvent,
  repoEvents,
  toEvent,
  toOpportunity,
} from "./store-db-mappers";

/**
 * EPIC-231: opportunity ops of the Postgres adapter — split from
 * store-db.ts at the 300-line cap (231-7 added updateOpportunity).
 */
export function dbOpportunityOps(
  repo: DemandRepository,
): Pick<
  DemandStore,
  | "getOpportunity"
  | "listOpportunities"
  | "createOpportunity"
  | "transitionOpportunity"
  | "updateOpportunity"
  | "linkBacklogTask"
> {
  return {
    async getOpportunity(id) {
      const row = await repo.getOpportunity(id);
      return row ? toOpportunity(row) : null;
    },

    async listOpportunities(opts) {
      const rows = await repo.listOpportunities({
        status: opts?.status,
        clusterId: opts?.clusterId,
        limit: opts?.limit,
        offset: opts?.offset,
      });
      return rows.map(toOpportunity);
    },

    async createOpportunity(input, events) {
      const out = await repo.createOpportunity(
        {
          id: input.id,
          clusterId: input.clusterId,
          title: input.title,
          hypothesis: input.hypothesis ?? null,
          expectedValue: input.expectedValue ?? null,
          metricsSnapshot: (input.metricsSnapshot ?? null) as RepoEventInput["payload"] | null,
          createdBy: input.createdBy,
        },
        repoEvents(events),
      );
      return {
        record: out.row ? toOpportunity(out.row) : null,
        created: out.created,
      };
    },

    async transitionOpportunity(id, input, event): Promise<DemandTransitionResult<DemandOpportunityRecord>> {
      const out = await repo.transitionOpportunity(
        id,
        {
          from: input.from,
          to: input.to,
          actor: input.actor,
          reason: input.reason ?? null,
          patch: input.patch,
          now: input.now,
        },
        repoEvent(event),
      );
      if (out.transitioned) {
        return {
          record: toOpportunity(out.row),
          event: toEvent(out.event),
          transitioned: true,
        };
      }
      return {
        record: out.row ? toOpportunity(out.row) : null,
        event: null,
        transitioned: false,
        reason: out.reason,
      };
    },

    async updateOpportunity(id, patch, expected, event): Promise<DemandTransitionResult<DemandOpportunityRecord>> {
      const out = await repo.updateOpportunity(
        id,
        {
          title: patch.title,
          hypothesis: patch.hypothesis,
          expectedValue: patch.expectedValue,
          declineReason: patch.declineReason,
        },
        expected,
        repoEvent(event),
      );
      if (out.transitioned) {
        return {
          record: toOpportunity(out.row),
          event: toEvent(out.event),
          transitioned: true,
        };
      }
      return {
        record: out.row ? toOpportunity(out.row) : null,
        event: null,
        transitioned: false,
        reason: out.reason,
      };
    },

    async linkBacklogTask(id, backlogTaskId, expected, event) {
      const res = await repo.linkBacklogTask(
        id,
        backlogTaskId,
        expected,
        repoEvent(event),
      );
      return res.linked
        ? { linked: true, record: toOpportunity(res.row) }
        : res;
    },
  };
}
