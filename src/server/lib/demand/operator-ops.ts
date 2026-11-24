/**
 * EPIC-231 (SLICE-231-6): shared operator gestures over the demand
 * store — used identically by the JSON API (231-5, idempotent-write
 * wrapper) and the SSR console (231-6, formToken PRG). Each op owns
 * the full sequence get → derive → store composite → post-commit
 * hooks so the two surfaces can never drift on event shapes.
 */

import { buildDemandEvent, emitDemandHooks } from "./events";
import { applyLevelRules } from "./level-rules";
import { normalizeClusterKey } from "./normalize";
import type { DemandStore } from "./store";
import type {
  DemandClusterRecord,
  DemandEventRecord,
  DemandLevel,
  DemandSignalRecord,
} from "./types";
import { DEMAND_LEVEL_RANK } from "./types";
import { generateReportId } from "../../../agent-readiness/integrity/ulid";

export type RetagResult =
  | {
      ok: true;
      signal: DemandSignalRecord;
      cluster: DemandClusterRecord | null;
    }
  | { ok: false; reason: "missing" | "linked_row" | "cluster_closed" };

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
  // Arc 231 R1 M9: a DISMISSED/LINKED cluster is a closed judgement —
  // retagging INTO one would resurrect it silently.
  const target = await store.getClusterByKey(clusterKey);
  if (target && target.status !== "OPEN" && target.status !== "TRIAGED") {
    return { ok: false, reason: "cluster_closed" };
  }
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
        // Arc 231 R1 H5: per-occurrence suffix — the event key is
        // globally @unique; retag A→B→A must not collide.
        `retag:${signal.id}:${clusterKey}:${generateReportId()}`,
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
  // Arc 231 R1 M9: the target cluster gained a canonical signal —
  // re-evaluate unique-actor floors (source can never demote via
  // rules; operator applyClusterLevel covers demotion if needed).
  // Arc 231 R2 L-5: the retag already committed — a rules failure is
  // best-effort, not a 500 that lies about the write (same pattern
  // as pipeline:233).
  const rules = r.cluster
    ? await applyLevelRules(store, r.cluster).catch(() => null)
    : null;
  return { ok: true, signal: r.signal!, cluster: rules?.cluster ?? r.cluster };
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
    // Arc 231 R1 H5: per-occurrence suffix — OPEN↔TRIAGED cycles
    // would collide on the globally-unique event key otherwise.
    `triage:${cluster.id}:${cluster.status}:${to}:${generateReportId()}`,
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

export type SetLevelResult =
  | { ok: true; cluster: DemandClusterRecord; event: DemandEventRecord }
  | { ok: false; reason: "missing" | "status_mismatch" | "illegal" | "no_change" };

/**
 * §16.1 VERIFIED gesture — the operator's explicit level set. This
 * is the ONLY way a cluster reaches VERIFIED_DEMAND (rules never
 * mint it): a payment/escrow fact or a confirmed deal, asserted by
 * a human. Demotion is equally legal — the operator corrects, the
 * floors only promote. CAS on the read level; target must be a
 * ladder level different from current.
 */
export async function setDemandClusterLevel(
  store: DemandStore,
  clusterId: string,
  to: DemandLevel,
  actor: string,
  reason: string | null = null,
): Promise<SetLevelResult> {
  // Arc 231 R2 L-10: `in` consults the prototype chain — "toString",
  // "constructor" would pass the allowlist. hasOwn is the real test.
  if (!Object.hasOwn(DEMAND_LEVEL_RANK, to)) {
    return { ok: false, reason: "illegal" };
  }
  const cluster = await store.getCluster(clusterId);
  if (!cluster) return { ok: false, reason: "missing" };
  if (cluster.level === to) return { ok: false, reason: "no_change" };
  // Arc 231 R2 N3: VERIFIED_DEMAND asserts a payment/escrow fact —
  // mint it without an operator-supplied reason and the audit row
  // carries no evidence.
  if (to === "VERIFIED_DEMAND" && !reason) {
    return { ok: false, reason: "illegal" };
  }
  const event = buildDemandEvent(
    "demand.cluster.updated",
    "INTERNAL",
    {
      clusterId: cluster.id,
      reason: "operator_level",
      note: reason,
      from: cluster.level,
      to,
      actor,
    },
    `level:${cluster.id}:${cluster.level}:${to}:${generateReportId()}`,
  );
  const r = await store.applyClusterLevel(
    cluster.id,
    { from: cluster.level, to },
    event,
  );
  if (!r.transitioned) return { ok: false, reason: r.reason };
  emitDemandHooks("cluster", cluster.id, [event]);
  return { ok: true, cluster: r.record!, event: r.event! };
}
