/**
 * EPIC-231 (SLICE-231-2, D-231-3/4): core demand pipeline — the ONLY
 * write-path for new signals (submitFeedback precedent).
 *
 *   ingest(input)
 *     → normalize(text)            NFKC→lower→collapse→trim
 *     → actorRef default           ANON actors bucket by session —
 *                                  unidentified actors never merge
 *                                  (landmine: actorResolution+actorRef)
 *     → dedupeKey                  sha256(actorRef+norm+24h window)
 *     → classify                   caller terms win; deterministic
 *                                  dictionary rules fill the rest (O2)
 *     → clusterKey                 dict:{cat}|{feat} / text:{norm}
 *     → level                      declaredLevel clamped at
 *                                  PURCHASE_INTENT — VERIFIED_DEMAND
 *                                  can never come from agent text
 *     → store.recordSignal         signal + cluster upsert + recount
 *                                  + events as ONE atomic unit
 *     → applyLevelRules            uniqueActors floors promote the
 *                                  cluster (CAS, monotone-max only)
 */

import { randomUUID } from "node:crypto";

import type { ResolvedActor } from "../agent-interaction/actor";
import type {
  DemandClusterRecord,
  DemandLevel,
  DemandSignalRecord,
  DemandSource,
} from "./types";
import type { DemandStore } from "./store";
import { buildDemandEvent, emitDemandHooks } from "./events";
import { applyLevelRules } from "./level-rules";
import {
  clampDeclaredLevel,
  DEMAND_DEDUPE_WINDOW_MS,
  demandDedupeKey,
  normalizeClusterKey,
  normalizeDemandText,
} from "./normalize";
import { classifyDemandText } from "./vocabulary";

export const DEMAND_TEXT_MAX = 1000;
export const DEMAND_CONTEXT_MAX = 1000;
/** O3 retention horizon — verbatim `context` is nulled by the
 *  retention janitor past this point (default now+90d). */
export const DEMAND_CONTEXT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface DemandIngestInput {
  /** Raw demand text — normalized inside (capability_query etc). */
  text: string;
  /** Verbatim caller context — retention-bounded (O3). */
  context?: string | null;
  /** Source claim — clamped at PURCHASE_INTENT. Default INTEREST. */
  declaredLevel?: DemandLevel;
  /** Caller-typed classification (seams/operators) — wins over the
   *  dictionary rules per-field; rules fill what is left out. */
  category?: string | null;
  feature?: string | null;
  capabilityKey?: string | null;
  source: DemandSource;
  /** Originating row ref for pull-model seams. */
  sourceRef?: string | null;
  sessionId?: string | null;
}

export type DemandIngestResult =
  | {
      ok: true;
      signal: DemandSignalRecord;
      cluster: DemandClusterRecord;
      canonicalOf: string | null;
      duplicate: boolean;
      /** Cluster level promoted by the uniqueActors floors. */
      promotedTo: DemandLevel | null;
    }
  | { ok: false; error: string; field?: string };

/** D-206-5 scope convention — per-actor namespace like feedback. */
const scopeFor = (source: DemandSource, actorRef: string | null) =>
  `demand:ingest:${source}:${actorRef ?? "anon"}`;

export async function ingestDemand(
  store: DemandStore,
  input: DemandIngestInput,
  actor: Pick<ResolvedActor, "resolution" | "actorRef">,
  opts?: {
    idempotencyKey?: string | null;
    dedupeScope?: string;
    now?: number;
  },
): Promise<DemandIngestResult> {
  // Arc 231 R1 M11: length is counted in CODE POINTS — a seam that
  // clamps with [...s].slice(0, N) then hits a UTF-16 length check
  // gets a spurious 400 on emoji-heavy text.
  if (
    typeof input.text !== "string" ||
    [...input.text].length > DEMAND_TEXT_MAX
  ) {
    return { ok: false, error: "text too long", field: "text" };
  }
  if ([...(input.context ?? "")].length > DEMAND_CONTEXT_MAX) {
    return { ok: false, error: "context too long", field: "context" };
  }
  // Codepoint-safe cap — a UTF-16 slice can split a surrogate pair.
  const normalizedText = [...normalizeDemandText(input.text)]
    .slice(0, DEMAND_TEXT_MAX)
    .join("");
  if (normalizedText.length === 0) {
    return { ok: false, error: "empty text", field: "text" };
  }

  // ANON actors have no identity ref — bucket them per session so
  // unidentified callers never merge into one fake actor (landmine).
  // Arc 231 R1 H2b: distinct `anon:sess:` namespace — a caller-chosen
  // sessionId like "ip:1.2.3.4" must never collide with the public
  // route's `anon:ip:` actor buckets; bounded length too.
  const sessionRef = input.sessionId
    ? `anon:sess:${String(input.sessionId).slice(0, 128)}`
    : null;
  const actorRef = actor.actorRef ?? sessionRef;
  const createdAtMs = opts?.now ?? Date.now();
  const dedupeKey = demandDedupeKey(normalizedText, actorRef);

  // Classification — caller terms win, rules fill the gaps.
  const classified = classifyDemandText(normalizedText);
  const category = input.category ?? classified.category;
  const feature = input.feature ?? classified.feature;
  const capabilityKey = input.capabilityKey ?? classified.capabilityKey;
  const clusterKey = normalizeClusterKey(category, feature, normalizedText);

  const declaredLevel = clampDeclaredLevel(
    input.declaredLevel ?? "INTEREST",
  );
  const id = `ds_${randomUUID()}`;

  const signalEvents = [
    buildDemandEvent(
      "demand.signal.created",
      "PUBLIC",
      {
        signalId: id,
        source: input.source,
        level: declaredLevel,
        category,
        feature,
      },
      `ev:${input.source}:${id}:1`,
    ),
    buildDemandEvent(
      "demand.signal.created",
      "INTERNAL",
      {
        signalId: id,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        actor: { resolution: actor.resolution, ref: actorRef },
        sessionId: input.sessionId ?? null,
        declaredLevel: input.declaredLevel ?? "INTEREST",
        level: declaredLevel,
        dedupeKey,
        normalizedText,
        category,
        feature,
        capabilityKey,
        clusterKey,
      },
      `ev:${input.source}:${id}:2`,
    ),
  ];
  const clusterEvents = [
    buildDemandEvent(
      "demand.cluster.updated",
      "INTERNAL",
      {
        clusterKey,
        signalId: id,
        reason: "ingest",
      },
      `ev:${input.source}:${id}:cluster`,
    ),
  ];

  const res = await store.recordSignal(
    {
      id,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      dedupeScope:
        opts?.dedupeScope ?? scopeFor(input.source, actorRef),
      idempotencyKey: opts?.idempotencyKey ?? null,
      normalizedText,
      context: input.context ?? null,
      contextRetainUntil: input.context
        ? new Date(createdAtMs + DEMAND_CONTEXT_RETENTION_MS).toISOString()
        : null,
      category,
      feature,
      capabilityKey,
      declaredLevel,
      level: declaredLevel,
      actorResolution: actor.resolution,
      actorRef,
      sessionId: input.sessionId ?? null,
      dedupeKey,
      createdAtMs,
      dedupeAfterMs: createdAtMs - DEMAND_DEDUPE_WINDOW_MS,
    },
    clusterKey,
    { signal: signalEvents, cluster: clusterEvents },
  );

  if (res.duplicate) {
    return {
      ok: true,
      signal: res.signal,
      cluster: res.cluster,
      canonicalOf: res.canonicalOf,
      duplicate: true,
      promotedTo: null,
    };
  }

  emitDemandHooks("signal", id, signalEvents);
  emitDemandHooks("cluster", res.cluster.id, clusterEvents);

  // Level rules — uniqueActors floors promote the cluster; a burst
  // dup (canonicalOf set) still lands on a recounted cluster, so the
  // rule run covers repeat-demand too. Arc 231 R1 M5: the signal is
  // already committed at this point — a rules failure must surface
  // as best-effort, not a 500 claiming the write never happened.
  const rules = await applyLevelRules(store, res.cluster).catch(() => ({
    promoted: false,
    cluster: res.cluster,
    target: null,
  }));

  return {
    ok: true,
    signal: res.signal,
    cluster: rules.cluster,
    canonicalOf: res.canonicalOf,
    duplicate: false,
    promotedTo: rules.promoted ? rules.target : null,
  };
}
