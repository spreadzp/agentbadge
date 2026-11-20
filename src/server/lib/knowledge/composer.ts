import { listEvidence } from "./evidence";
import { relationsFor } from "./relations";
import { searchKnowledgeItems } from "./search";
import type { KnowledgeStore } from "./store";
import type { KnowledgeSearchHit } from "./types";

/**
 * EPIC-229 (SLICE-229-7, D-229-6, O-229-2, O-229-4): deterministic
 * answer composer. NO LLM, no network — pure composition over
 * PUBLISHED items (EPIC-181 honest-refusal contract).
 *
 * Confidence is computed HERE, not taken from engine rank —
 * memory rank is a 0..1 term-coverage fraction while ts_rank is an
 * unbounded float; a composer-side coverage score over
 * title+summary keeps the threshold meaningful on both engines
 * and keeps the whole thing replayable/testable.
 */

/** O-229-2: conservative start — tune on fixtures later. */
export const CONFIDENCE_THRESHOLD = 0.6;
const SEARCH_LIMIT = 5;
const RELATED_TYPES = new Set(["RELATED_TO", "DEPENDS_ON"]);

export interface ComposedSource {
  itemId: string;
  slug: string;
  title: string;
  snippet: string;
  evidence: { type: string; uri: string; label: string | null }[];
}

export interface ComposedAnswer {
  status: "ANSWERED" | "REFUSED";
  answerText: string | null;
  sources: ComposedSource[];
  /** Related published items ("see also" beyond search hits). */
  related: { slug: string; title: string; type: string }[];
  confidence: number;
  reason: string | null;
  hint: string | null;
}

/** 229-8 seam — real gap recording lands next slice; optional here. */
export interface KnowledgeGapRecorder {
  recordGap(input: {
    query: string;
    source: "COMPOSER_REFUSAL";
    confidence: number;
  }): Promise<void> | void;
}

function tokenize(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t.length >= 2),
    ),
  ];
}

/** Fraction of query terms covered by title+summary — engine-agnostic. */
function coverageOf(terms: string[], h: KnowledgeSearchHit): number {
  if (terms.length === 0) return 0;
  const hay = `${h.title} ${h.summary ?? ""}`.toLowerCase();
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits += 1;
  return hits / terms.length;
}

function computeConfidence(
  terms: string[],
  hits: KnowledgeSearchHit[],
): number {
  if (hits.length === 0 || terms.length === 0) return 0;
  const covs = hits.map((h) => coverageOf(terms, h));
  const top = Math.max(...covs);
  // Supporting hits: how many other docs independently cover ≥ half
  // the query terms — corroboration, not just one lucky match.
  const support = covs.filter((c) => c >= 0.5).length / SEARCH_LIMIT;
  return Math.min(1, top * 0.8 + support * 0.2);
}

function composeText(
  top: KnowledgeSearchHit,
  rest: KnowledgeSearchHit[],
  related: { slug: string; title: string; type: string }[],
): string {
  const lines = ["Based on verified knowledge:", ""];
  lines.push(top.summary ?? top.snippet);
  if (rest.length > 0) {
    lines.push("", "See also:");
    for (const h of rest) lines.push(`- ${h.slug} — ${h.title}`);
  }
  if (related.length > 0) {
    lines.push("", "Related topics:");
    for (const r of related) lines.push(`- ${r.slug} — ${r.title}`);
  }
  return lines.join("\n");
}

export async function composeAnswer(
  store: KnowledgeStore,
  query: string,
  deps: { gapRecorder?: KnowledgeGapRecorder } = {},
): Promise<ComposedAnswer> {
  const res = await searchKnowledgeItems(store, query, {
    status: "PUBLISHED",
    limit: SEARCH_LIMIT,
  });
  const terms = tokenize(query);
  const confidence = computeConfidence(terms, res.items);

  if (res.items.length === 0 || confidence < CONFIDENCE_THRESHOLD) {
    try {
      await deps.gapRecorder?.recordGap({
        query,
        source: "COMPOSER_REFUSAL",
        confidence,
      });
    } catch {
      /* gap recording must never break a refusal */
    }
    return {
      status: "REFUSED",
      answerText: null,
      sources: [],
      related: [],
      confidence,
      reason: "insufficient_verified_knowledge",
      hint:
        "No published knowledge covers this query confidently. " +
        "The gap was recorded for operator review — retry later or " +
        "narrow the question to a documented capability.",
    };
  }

  const top = res.items[0] as KnowledgeSearchHit;
  const rest = res.items.slice(1);

  // Related items from the top hit — published only, typed edges
  // only. Titles live on versions; resolve the published one.
  const rels = await relationsFor(store, top.itemId);
  const relatedClean = await Promise.all(
    [...rels.outgoing, ...rels.incoming]
      .filter(
        (e) => RELATED_TYPES.has(e.type) && e.item.status === "PUBLISHED",
      )
      .map(async (e) => {
        const v = e.item.publishedVersionId
          ? await store.getVersion(e.item.publishedVersionId)
          : null;
        return {
          slug: e.item.slug,
          title: v?.title ?? e.item.slug,
          type: e.type,
        };
      }),
  );

  const sources: ComposedSource[] = await Promise.all(
    res.items.map(async (h) => ({
      itemId: h.itemId,
      slug: h.slug,
      title: h.title,
      snippet: h.snippet,
      evidence: (await listEvidence(store, h.versionId)).map((e) => ({
        type: e.type,
        uri: e.uri,
        label: e.label,
      })),
    })),
  );

  return {
    status: "ANSWERED",
    answerText: composeText(top, rest, relatedClean),
    sources,
    related: relatedClean,
    confidence,
    reason: null,
    hint: null,
  };
}
