/**
 * EPIC-231 (SLICE-231-6): shared operator gestures over the demand
 * store — used identically by the JSON API (231-5, idempotent-write
 * wrapper) and the SSR console (231-6, formToken PRG). Each op owns
 * the full sequence get → derive → store composite → post-commit
 * hooks so the two surfaces can never drift on event shapes.
 */

import { buildDemandEvent, emitDemandHooks } from "./events";
import { normalizeClusterKey } from "./normalize";
import type { DemandStore } from "./store";
import type {
  DemandClusterRecord,
  DemandEventRecord,
  DemandOpportunityRecord,
  DemandSignalRecord,
} from "./types";
import { generateReportId } from "../../../agent-readiness/integrity/ulid";

export type RetagResult =
  | {
      ok: true;
      signal: DemandSignalRecord;
      cluster: DemandClusterRecord | null;
    }
  | { ok: false; reason: "missing" | "linked_row" };

/** Operator re-tag — clusterKey re-derived from the FINAL
 *  category/feature (dict: namespace); absent≠null in the patch
 *  (undefined=keep, null=clear). Linked rows refuse. */
export async function retagDemandSignal(
  store: DemandStore,
  signalId: string,
  patch: { category?: string | null; feature?: string | null },
  actor: string,
): Promise<RetagResult> {
  const signal = await store.getSignal(signalId);
  if (!signal) return { ok: false, reason: "missing" };
  const category = "category" in patch ? patch.category : signal.category;
  const feature = "feature" in patch ? patch.feature : signal.feature;
  const clusterKey = normalizeClusterKey(
    category ?? null,
    feature ?? null,
    signal.normalizedText,
  );
  const events = {
    signal: [
      buildDemandEvent(
        "demand.signal.retagged",
        "INTERNAL",
        {
          signalId: signal.id,
          from: { category: signal.category, feature: signal.feature },
          to: { category: category ?? null, feature: feature ?? null },
          clusterKey,
          actor,
        },
        `retag:${signal.id}:${clusterKey}`,
      ),
    ],
    cluster: [
      buildDemandEvent("demand.cluster.updated", "INTERNAL", {
        reason: "signal_retag",
        signalId: signal.id,
        actor,
      }),
    ],
  };
  const r = await store.retagSignal(
    signal.id,
    { clusterKey, category: category ?? null, feature: feature ?? null },
    events,
  );
  if (r.detached !== "ok") return { ok: false, reason: r.detached };
  emitDemandHooks("signal", signal.id, events.signal!);
  if (r.cluster) emitDemandHooks("cluster", r.cluster.id, events.cluster!);
  return { ok: true, signal: r.signal!, cluster: r.cluster };
}

export type TriageResult =
  | {
      ok: true;
      cluster: DemandClusterRecord;
      event: DemandEventRecord;
    }
  | { ok: false; reason: "missing" | "status_mismatch" | "illegal" };

/** Cluster lifecycle transition — the store's from→to table owns
 *  legality; the operator's read is passed as `from` (CAS). */
export async function triageDemandCluster(
  store: DemandStore,
  clusterId: string,
  to: string,
  reason: string | null,
  actor: string,
): Promise<TriageResult> {
  const cluster = await store.getCluster(clusterId);
  if (!cluster) return { ok: false, reason: "missing" };
  const event = buildDemandEvent(
    "demand.cluster.updated",
    "INTERNAL",
    {
      clusterId: cluster.id,
      from: cluster.status,
      to,
      actor,
      reason,
    },
    `triage:${cluster.id}:${cluster.status}:${to}`,
  );
  const r = await store.transitionCluster(
    cluster.id,
    { from: cluster.status, to, actor, reason },
    event,
  );
  if (!r.transitioned) return { ok: false, reason: r.reason };
  emitDemandHooks("cluster", cluster.id, [event]);
  return { ok: true, cluster: r.record!, event: r.event! };
}

export type CreateOpportunityResult =
  | { ok: true; opportunity: DemandOpportunityRecord }
  | { ok: false; reason: "missing" };

/** «→ Opportunity» gesture — PROPOSED draft on an existing cluster;
 *  metricsSnapshot freezes the cluster counters at proposal time. */
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
      },
      createdBy: actor,
    },
    events,
  );
  if (!r.created || !r.record) return { ok: false, reason: "missing" };
  emitDemandHooks("opportunity", r.record.id, events);
  return { ok: true, opportunity: r.record };
}
