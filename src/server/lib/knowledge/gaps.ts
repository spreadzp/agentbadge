import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import {
  KNOWLEDGE_GAP_SOURCES,
  type KnowledgeGapRecord,
} from "./types";

/**
 * EPIC-229 (SLICE-229-8, D-229-7, O-229-6): persisted knowledge gaps.
 * A gap = "an agent asked and we had no verified answer" — deduped
 * by normalizedQuery, counted, sampled (cap 10 verbatim queries),
 * and triaged by operators into RESOLVED (linked item) or WONTFIX.
 * Sources: COMPOSER_REFUSAL (229-7 composer), INTERACTION_SIGNAL
 * (EPIC-228 classify seam), MANUAL.
 *
 * `knowledge.gap.detected` emits ONLY on first sighting — count++
 * on a known gap is not news.
 */

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["TRIAGED"],
  TRIAGED: ["RESOLVED", "WONTFIX"],
  RESOLVED: [],
  WONTFIX: [],
};

/** demand-registry normalize pattern — same query ≠ new gap. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function recordGap(
  store: KnowledgeStore,
  input: {
    query: string;
    source: string;
    capabilityRef?: string | null;
    intent?: string | null;
    sourceRef?: string | null;
  },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord; created: boolean }>> {
  if (!KNOWLEDGE_GAP_SOURCES.includes(input.source as never)) {
    return { ok: false, error: "bad_gap_source", field: "source" };
  }
  const query = input.query.trim();
  const normalized = normalizeQuery(query);
  if (normalized.length < 2 || normalized.length > 500) {
    return { ok: false, error: "bad_query", field: "query" };
  }
  const res = await store.recordGap({
    id: `kgap_${randomUUID()}`,
    normalizedQuery: normalized,
    sampleQuery: query.slice(0, 500),
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    capabilityRef: input.capabilityRef ?? null,
    intent: input.intent ?? null,
  });
  if (res.created) {
    emitKnowledgeEvent("knowledge.gap.detected", {
      gapId: res.row.id,
      normalizedQuery: res.row.normalizedQuery,
      source: res.row.source,
      capabilityRef: res.row.capabilityRef,
      intent: res.row.intent,
      sourceRef: res.row.sourceRef,
    });
  }
  return { ok: true, gap: res.row, created: res.created };
}

/** O-229-6 seam: EPIC-228 classify patches (knowledgeGap:true)
 *  funnel here — sourceRef = the ireq_* request id. */
export function recordInteractionGap(
  store: KnowledgeStore,
  input: {
    requestId: string;
    query: string;
    intent?: string | null;
    capabilityRef?: string | null;
  },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord; created: boolean }>> {
  return recordGap(store, {
    query: input.query,
    source: "INTERACTION_SIGNAL",
    sourceRef: input.requestId,
    intent: input.intent,
    capabilityRef: input.capabilityRef,
  });
}

/** 229-7 composer seam — the KnowledgeGapRecorder interface impl. */
export function knowledgeGapRecorder(store: KnowledgeStore) {
  return {
    async recordGap(input: {
      query: string;
      source: "COMPOSER_REFUSAL";
      confidence: number;
    }): Promise<void> {
      await recordGap(store, {
        query: input.query,
        source: input.source,
      });
    },
  };
}

export function listGaps(
  store: KnowledgeStore,
  opts: { status?: string; sort?: "count" | "lastSeen"; limit?: number } = {},
): Promise<KnowledgeGapRecord[]> {
  return store.listGaps({
    status: opts.status,
    orderBy: opts.sort ?? "count",
    limit: opts.limit ?? 100,
  });
}

async function transition(
  store: KnowledgeStore,
  id: string,
  to: "TRIAGED" | "RESOLVED" | "WONTFIX",
  linkedItemId?: string | null,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  const gap = await store.getGap(id);
  if (!gap) return { ok: false, error: "not_found" };
  if (!VALID_TRANSITIONS[gap.status]?.includes(to)) {
    return {
      ok: false,
      error: `invalid_transition:${gap.status}->${to}`,
      field: "to",
    };
  }
  if (to === "RESOLVED") {
    if (!linkedItemId) {
      return { ok: false, error: "linked_item_required", field: "linkedItemId" };
    }
    if ((await store.getItem(linkedItemId)) === null) {
      return { ok: false, error: "linked_item_missing", field: "linkedItemId" };
    }
  }
  const res = await store.transitionGap(id, {
    from: gap.status,
    to,
    linkedItemId: linkedItemId ?? null,
  });
  if (!res.transitioned || !res.gap) {
    return { ok: false, error: "status_race" };
  }
  return { ok: true, gap: res.gap };
}

export function triageGap(
  store: KnowledgeStore,
  id: string,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  return transition(store, id, "TRIAGED");
}

export function resolveGap(
  store: KnowledgeStore,
  id: string,
  linkedItemId: string,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  return transition(store, id, "RESOLVED", linkedItemId);
}

export function wontfixGap(
  store: KnowledgeStore,
  id: string,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  return transition(store, id, "WONTFIX");
}
