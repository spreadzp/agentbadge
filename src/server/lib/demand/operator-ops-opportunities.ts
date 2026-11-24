/**
 * EPIC-231 (SLICE-231-11 split): opportunity operator gestures —
 * transition / field-edit / «→ Opportunity» draft. Same shared-ops
 * contract as operator-ops.ts (JSON API + SSR console call the
 * same sequence). Split for the 300-line cap.
 */

import { buildDemandEvent, emitDemandHooks } from "./events";
import { sanitizeCardText, BACKLOG_EXAMPLE_LIMIT } from "./backlog-card";
import type { DemandStore } from "./store";
import type {
  DemandEventRecord,
  DemandOpportunityRecord,
} from "./types";
import { generateReportId } from "../../../agent-readiness/integrity/ulid";

export type OpportunityOpResult =
  | {
      ok: true;
      opportunity: DemandOpportunityRecord;
      event: DemandEventRecord;
    }
  | { ok: false; reason: "missing" | "status_mismatch" | "illegal" | "no_patch" };

/**
 * Opportunity lifecycle transition (231-7) — the store's from→to
 * table owns legality (effects: closedAt on terminal, patch fields
 * applied). `to=LINKED` refuses here: LINKED is reachable only
 * through the «→ Backlog task» gesture (linkBacklogTask, 231-8) so
 * a LINKED row always carries backlogTaskId.
 */
export async function transitionDemandOpportunity(
  store: DemandStore,
  opportunityId: string,
  to: string,
  input: {
    reason?: string | null;
    patch?: {
      title?: string;
      hypothesis?: string | null;
      expectedValue?: string | null;
      declineReason?: string | null;
    };
  },
  actor: string,
): Promise<OpportunityOpResult> {
  if (to === "LINKED") return { ok: false, reason: "illegal" };
  const cur = await store.getOpportunity(opportunityId);
  if (!cur) return { ok: false, reason: "missing" };
  const event = buildDemandEvent(
    "demand.opportunity.updated",
    "INTERNAL",
    {
      opportunityId: cur.id,
      from: cur.status,
      to,
      actor,
      reason: input.reason ?? null,
      patch: input.patch ?? null,
    },
    `opp-transition:${cur.id}:${cur.status}:${to}:${generateReportId()}`,
  );
  const r = await store.transitionOpportunity(
    cur.id,
    {
      from: cur.status,
      to,
      actor,
      reason: input.reason ?? null,
      patch: input.patch,
    },
    event,
  );
  if (!r.transitioned) return { ok: false, reason: r.reason };
  emitDemandHooks("opportunity", cur.id, [event]);
  return { ok: true, opportunity: r.record!, event: r.event! };
}

/**
 * Operator field edit without a status move (231-7) — CAS on the
 * read status; requires at least one field in the patch.
 */
export async function updateDemandOpportunity(
  store: DemandStore,
  opportunityId: string,
  patch: {
    title?: string;
    hypothesis?: string | null;
    expectedValue?: string | null;
    declineReason?: string | null;
  },
  actor: string,
): Promise<OpportunityOpResult> {
  if (Object.values(patch).every((v) => v === undefined)) {
    return { ok: false, reason: "no_patch" };
  }
  const cur = await store.getOpportunity(opportunityId);
  if (!cur) return { ok: false, reason: "missing" };
  const event = buildDemandEvent(
    "demand.opportunity.updated",
    "INTERNAL",
    {
      opportunityId: cur.id,
      action: "edit",
      actor,
      patch,
    },
    `opp-edit:${cur.id}:${cur.status}:${generateReportId()}`,
  );
  const r = await store.updateOpportunity(
    cur.id,
    patch,
    { status: cur.status },
    event,
  );
  if (!r.transitioned) return { ok: false, reason: r.reason };
  emitDemandHooks("opportunity", cur.id, [event]);
  return { ok: true, opportunity: r.record!, event: r.event! };
}

export type CreateOpportunityResult =
  | { ok: true; opportunity: DemandOpportunityRecord }
  | { ok: false; reason: "missing" };

/** «→ Opportunity» gesture — PROPOSED draft on an existing cluster;
 *  metricsSnapshot freezes the cluster counters AND the sanitized
 *  request examples at proposal time (Arc 231 R1 H4 — the exported
 *  card must not drift with live signals or verbatim context). */
export async function createDemandOpportunity(
  store: DemandStore,
  clusterId: string,
  input: { title?: string; hypothesis?: string | null },
  actor: string,
): Promise<CreateOpportunityResult> {
  const cluster = await store.getCluster(clusterId);
  if (!cluster) return { ok: false, reason: "missing" };
  const id = `do_${generateReportId()}`;
  const title = input.title?.trim() || cluster.clusterKey;
  const canonical = await store.listSignals({
    clusterId: cluster.id,
    canonicalOnly: true,
    limit: BACKLOG_EXAMPLE_LIMIT,
  });
  const events = [
    buildDemandEvent(
      "demand.opportunity.created",
      "INTERNAL",
      {
        opportunityId: id,
        clusterId: cluster.id,
        title,
        actor,
      },
      `opp:${cluster.id}:${id}`,
    ),
  ];
  const r = await store.createOpportunity(
    {
      id,
      clusterId: cluster.id,
      title,
      hypothesis: input.hypothesis ?? null,
      metricsSnapshot: {
        count: cluster.count,
        uniqueActors: cluster.uniqueActors,
        level: cluster.level,
        levelBreakdown: cluster.levelBreakdown,
        examples: canonical.map((s) => sanitizeCardText(s.normalizedText)),
      },
      createdBy: actor,
    },
    events,
  );
  if (!r.created || !r.record) return { ok: false, reason: "missing" };
  emitDemandHooks("opportunity", r.record.id, events);
  return { ok: true, opportunity: r.record };
}
