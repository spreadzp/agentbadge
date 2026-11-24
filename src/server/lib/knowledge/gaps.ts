import { randomUUID } from "node:crypto";

import type { DemandStore } from "../demand/store";
import { recordGapDemand } from "../demand/seams";
import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import { lifecycleGapEvent } from "./gap-events";
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
 * `knowledge.gap_detected` emits ONLY on first sighting — count++ on
 * a known gap is not news. */

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["TRIAGED"],
  TRIAGED: ["RESOLVED", "WONTFIX"],
  RESOLVED: [],
  WONTFIX: [],
};

/** Arc R1 H3 cap: OPEN gaps bounded — the public ask surface creates
 *  a row per novel query (unauth writers can't grow the queue). */
export const KNOWLEDGE_GAP_OPEN_CAP = 2000;

/** demand-registry normalize — same query ≠ new gap. Arc R1 H3:
 *  NFKC + strip format/mark chars + collapse punctuation to space —
 *  zero-width/confusable variants dedupe onto ONE row. */
export function normalizeQuery(q: string): string {
  return q
    .normalize("NFKC")
    .toLowerCase()
    // Arc R3 M-7: keep \p{M} — stripping marks destroyed Indic
    // vowel signs (हिन्दी → हनद).
    .replace(/\p{Cf}/gu, "")
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
  deps?: { demand?: DemandStore },
): Promise<
  KnowledgeResult<{
    gap: KnowledgeGapRecord | null;
    created: boolean;
    /** Arc R2 M-1: false when the sighting was honestly dropped
     *  (backlog full / WONTFIX final) — callers must not claim a
     *  recording that didn't happen. */
    recorded: boolean;
    /** Arc R4 M-1: distinct flag — true only when the row actually
     *  re-entered the OPEN queue. A capped RESOLVED row records the
     *  sighting (recorded:true) without reopening — callers should
     *  not phrase it as "back in review". */
    reopened: boolean;
  }>
> {
  if (!KNOWLEDGE_GAP_SOURCES.includes(input.source as never)) {
    return { ok: false, error: "bad_gap_source", field: "source" };
  }
  // Arc R3 M-7: collapse whitespace BEFORE the strict check — a
  // newline/tab in an agent prompt dropped the whole demand signal
  // as bad_query. The stored sample is the collapsed form.
  const query = input.query.replace(/\s+/g, " ").trim();
  if (query.length === 0 || !noCtrlStrict(query)) {
    return { ok: false, error: "bad_query", field: "query" };
  }
  const normalized = normalizeQuery(query);
  // Arc R3 M-7: length judges the RAW query (c++, c#, 税 are real
  // questions); the normalized key only has to be non-empty/bounded.
  const hasCjk =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      query,
    );
  const rawLen = [...query].length;
  if (
    (rawLen < 2 && !hasCjk) ||
    normalized.length === 0 ||
    normalized.length > 500
  ) {
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
    // 231-4 seam (soft-dep, fire-and-forget): a first-sighting gap is
    // asked-for demand — an answer an agent wanted and we lacked.
    if (deps?.demand) {
      const row = res.row;
      void recordGapDemand(deps.demand, {
        gapId: row.id,
        query: row.sampleQueries[0] ?? row.normalizedQuery,
        capabilityRef: row.capabilityRef,
        reason: "detected",
      }).catch(() => {});
    }
  }
  // Arc R2 M-1: a RESOLVED gap that reopens is an event too — the
  // queue silently filling back up is the signal this surfaces.
  if (res.reopened === true && res.row) {
    emitKnowledgeEvent("knowledge.gap_reopened", {
      gapId: res.row.id,
      normalizedQuery: res.row.normalizedQuery,
      source: res.row.source,
    });
    // A reopened gap is demand resurfacing after RESOLVED — one extra
    // re-signal (distinct idempotency key), then replays dedupe.
    if (deps?.demand) {
      const row = res.row;
      void recordGapDemand(deps.demand, {
        gapId: row.id,
        query: row.sampleQueries[0] ?? row.normalizedQuery,
        capabilityRef: row.capabilityRef,
        reason: "reopened",
      }).catch(() => {});
    }
  }
  return {
    ok: true,
    gap: res.row,
    created: res.created,
    recorded: res.recorded,
    reopened: res.reopened === true,
  };
}

/** Arc R1 M8: the 228 hook's fields are validated inside recordGap
 *  (ireq_* sourceRef shape, bounded single-line intent/capabilityRef). */

/** 229-7 composer seam (Arc R1 H3 + R2 M-1) — reports whether the
 *  write actually LANDED (a WONTFIX-hit or cap-blocked row isn't a
 *  recording) so the refusal hint stays honest. */
export function knowledgeGapRecorder(
  store: KnowledgeStore,
  deps?: { demand?: DemandStore },
) {
  return {
    async recordGap(input: {
      query: string;
      source: "COMPOSER_REFUSAL";
      confidence: number;
    }): Promise<boolean> {
      const r = await recordGap(
        store,
        {
          query: input.query,
          source: input.source,
        },
        deps,
      );
      return r.ok && r.recorded === true;
    },
  };
}

export function listGaps(
  store: KnowledgeStore,
  opts: {
    status?: string;
    /** 264-12/14: sort + pool/live-overdue gates pass to the store. */
    sort?: "count" | "lastSeen" | "overdue";
    unassigned?: boolean;
    overdueOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<KnowledgeGapRecord[]> {
  return store.listGaps({
    status: opts.status,
    orderBy: opts.sort ?? "count",
    unassigned: opts.unassigned,
    overdueOnly: opts.overdueOnly,
    limit: opts.limit ?? 100,
    offset: opts.offset,
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
    // 264-10/11: RESOLVED stamps; the actor's row rides the write.
    resolvedAt: to === "RESOLVED" ? new Date().toISOString() : null,
    event: lifecycleGapEvent(gap, to, actorRef),
  });
  if (!res.transitioned || !res.gap) {
    return { ok: false, error: "status_race" };
  }
  // Arc R1 M7: lifecycle actions record WHO moved the gap.
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
