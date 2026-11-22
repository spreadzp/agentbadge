import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import {
  KNOWLEDGE_GAP_SOURCES,
  noCtrlStrict,
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
 * `knowledge.gap_detected` emits ONLY on first sighting — count++
 * on a known gap is not news.
 */

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["TRIAGED"],
  TRIAGED: ["RESOLVED", "WONTFIX"],
  RESOLVED: [],
  WONTFIX: [],
};

/** Arc R1 H3 cap: distinct OPEN gaps are bounded — the public ask
 *  surface creates a row per novel normalized query, so an
 *  unauthenticated writer could otherwise grow the table and the
 *  operator queue without limit. */
export const KNOWLEDGE_GAP_OPEN_CAP = 2000;

/** demand-registry normalize pattern — same query ≠ new gap.
 *  Arc R1 H3: NFKC + strip format/mark chars + collapse punctuation
 *  to space — zero-width/confusable/trailing-punct variants now
 *  dedupe onto ONE row instead of minting one each. */
export function normalizeQuery(q: string): string {
  return q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Codepoint-safe truncate — slice() can split surrogate pairs. */
const cpSlice = (s: string, n: number) => [...s].slice(0, n).join("");

export async function recordGap(
  store: KnowledgeStore,
  input: {
    query: string;
    source: string;
    capabilityRef?: string | null;
    intent?: string | null;
    sourceRef?: string | null;
  },
): Promise<
  KnowledgeResult<{
    gap: KnowledgeGapRecord | null;
    created: boolean;
    /** Arc R2 M-1: false when the sighting was honestly dropped
     *  (backlog full / WONTFIX final) — callers must not claim a
     *  recording that didn't happen. */
    recorded: boolean;
  }>
> {
  if (!KNOWLEDGE_GAP_SOURCES.includes(input.source as never)) {
    return { ok: false, error: "bad_gap_source", field: "source" };
  }
  const query = input.query.trim();
  // Arc R2 M-1: the raw query was unvalidated at the lib edge —
  // control/format chars went straight into sampleQueries (verbatim
  // operator console render) and normalized dedupe.
  if (query.length === 0 || !noCtrlStrict(query)) {
    return { ok: false, error: "bad_query", field: "query" };
  }
  const normalized = normalizeQuery(query);
  if (normalized.length < 2 || normalized.length > 500) {
    return { ok: false, error: "bad_query", field: "query" };
  }
  // Arc R2 M-1: the OPEN cap moved inside the store's write tx —
  // only NEW rows are cap-gated (a full backlog can no longer freeze
  // dedupe bumps, and the check can't be raced).
  const res = await store.recordGap(
    {
      id: `kgap_${randomUUID()}`,
      normalizedQuery: normalized,
      sampleQuery: cpSlice(query, 500),
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      capabilityRef: input.capabilityRef ?? null,
      intent: input.intent ?? null,
    },
    { openCap: KNOWLEDGE_GAP_OPEN_CAP },
  );
  if (res.created && res.row) {
    emitKnowledgeEvent("knowledge.gap_detected", {
      gapId: res.row.id,
      normalizedQuery: res.row.normalizedQuery,
      source: res.row.source,
      capabilityRef: res.row.capabilityRef,
      intent: res.row.intent,
      sourceRef: res.row.sourceRef,
    });
  }
  // Arc R2 M-1: a RESOLVED gap that reopens is an event too — the
  // operator queue silently filling back up is exactly the signal
  // the lifecycle was built to surface.
  if (res.reopened === true && res.row) {
    emitKnowledgeEvent("knowledge.gap_reopened", {
      gapId: res.row.id,
      normalizedQuery: res.row.normalizedQuery,
      source: res.row.source,
    });
  }
  return {
    ok: true,
    gap: res.row,
    created: res.created,
    recorded: res.recorded,
  };
}

/** Arc R1 M8: the 228 hook's fields get validated — an ireq_*
 *  sourceRef shape, bounded single-line intent/capabilityRef. */
const IREQ_REF_RE = /^ireq_[A-Za-z0-9_-]{1,80}$/;
const bounded = (s: string | null | undefined, max: number) =>
  s === null || s === undefined || (s.length <= max && noCtrlStrict(s));

export function recordInteractionGap(
  store: KnowledgeStore,
  input: {
    requestId: string;
    query: string;
    intent?: string | null;
    capabilityRef?: string | null;
  },
): Promise<
  KnowledgeResult<{
    gap: KnowledgeGapRecord | null;
    created: boolean;
    recorded: boolean;
  }>
> {
  if (
    !IREQ_REF_RE.test(input.requestId) ||
    !bounded(input.intent, 200) ||
    !bounded(input.capabilityRef, 200)
  ) {
    return Promise.resolve({
      ok: false,
      error: "bad_source_ref",
      field: "sourceRef",
    });
  }
  return recordGap(store, {
    query: input.query,
    source: "INTERACTION_SIGNAL",
    sourceRef: input.requestId,
    intent: input.intent,
    capabilityRef: input.capabilityRef,
  });
}

/** 229-7 composer seam — the KnowledgeGapRecorder interface impl.
 *  Arc R1 H3 + R2 M-1: reports whether the write actually LANDED
 *  (a WONTFIX-hit or cap-blocked row isn't a recording) so the
 *  refusal hint stays honest. */
export function knowledgeGapRecorder(store: KnowledgeStore) {
  return {
    async recordGap(input: {
      query: string;
      source: "COMPOSER_REFUSAL";
      confidence: number;
    }): Promise<boolean> {
      const r = await recordGap(store, {
        query: input.query,
        source: input.source,
      });
      return r.ok && r.recorded === true;
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
  actorRef?: string,
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
    const linked = await store.getItem(linkedItemId);
    if (linked === null) {
      return { ok: false, error: "linked_item_missing", field: "linkedItemId" };
    }
    // Arc R1 M7: only a PUBLISHED item resolves a gap — a DRAFT or
    // WITHDRAWN one cannot answer the agent's question.
    if (linked.status !== "PUBLISHED") {
      return {
        ok: false,
        error: "linked_item_not_published",
        field: "linkedItemId",
      };
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
  // Arc R1 M7: lifecycle actions record WHO moved the gap (domain
  // event — the gap table carries no actor column).
  emitKnowledgeEvent(`knowledge.gap_${to.toLowerCase()}`, {
    gapId: id,
    from: gap.status,
    to,
    actor: actorRef ?? null,
    linkedItemId: linkedItemId ?? null,
  });
  return { ok: true, gap: res.gap };
}

export function triageGap(
  store: KnowledgeStore,
  id: string,
  actorRef?: string,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  return transition(store, id, "TRIAGED", null, actorRef);
}

export function resolveGap(
  store: KnowledgeStore,
  id: string,
  linkedItemId: string,
  actorRef?: string,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  return transition(store, id, "RESOLVED", linkedItemId, actorRef);
}

export function wontfixGap(
  store: KnowledgeStore,
  id: string,
  actorRef?: string,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  return transition(store, id, "WONTFIX", null, actorRef);
}
