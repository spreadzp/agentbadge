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
  /** Arc R1 H4: internal evidence types (INTERNAL_DOC, SCAN_REPORT)
   *  keep type+label but uri is nulled — an internal pointer must
   *  not leak to anonymous callers. */
  evidence: { type: string; uri: string | null; label: string | null }[];
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

/** 229-8 seam — real gap recording lands next slice; optional here.
 *  Arc R1 H3: reports whether the gap row landed so the refusal
 *  hint doesn't claim a recording that never happened. */
export interface KnowledgeGapRecorder {
  recordGap(input: {
    query: string;
    source: "COMPOSER_REFUSAL";
    confidence: number;
  }): Promise<boolean> | boolean;
}

/** Arc R1 M4: internal pointers don't leave the building. */
const PRIVATE_EVIDENCE_TYPES = new Set(["INTERNAL_DOC", "SCAN_REPORT"]);

/** Arc R1 M6: unicode-aware terms — [^a-z0-9] tokenization deleted
 *  every non-ASCII word ("支払い café" → ["caf"]). Letters+numbers
 *  in any script, ≥2 chars, deduped; common English stopwords out
 *  (they inflate coverage of natural-language questions). */
const STOPWORDS = new Set([
  "an", "as", "at", "be", "by", "do", "for", "how", "if", "in", "is",
  "it", "of", "on", "or", "so", "the", "to", "up", "we", "a", "i",
  "am", "are", "can", "did", "has", "me", "my", "no", "not", "our",
  "us", "was", "you", "your", "what", "when", "where", "who", "why",
  "does", "and", "with", "that", "this", "from", "about", "into",
]);

function tokenize(q: string): string[] {
  return [
    ...new Set(
      (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
        (t) => !STOPWORDS.has(t),
      ),
    ),
  ];
}

/** Fraction of query terms covered — word-boundary matching, not
 *  substring: "an" used to "match" inside any word, inflating
 *  coverage. Title+summary carry editorial weight, snippet carries
 *  the terms the engine actually matched in the body. */
function coverageOf(terms: string[], h: KnowledgeSearchHit): number {
  if (terms.length === 0) return 0;
  const hay = new Set(
    `${h.title} ${h.summary ?? ""} ${h.snippet}`
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  let hits = 0;
  for (const t of terms) if (hay.has(t)) hits += 1;
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
    let recorded = false;
    try {
      recorded =
        (await deps.gapRecorder?.recordGap({
          query,
          source: "COMPOSER_REFUSAL",
          confidence,
        })) === true;
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
        (recorded
          ? "The gap was recorded for operator review — retry later " +
            "or narrow the question to a documented capability."
          : "Retry later or narrow the question to a documented capability."),
    };
  }

  const top = res.items[0] as KnowledgeSearchHit;
  const rest = res.items.slice(1);

  // Related items from the top hit — published only, typed edges
  // only. Titles live on versions; resolve the published one.
  const rels = await relationsFor(store, top.itemId);
  // Arc R1 M5: an item linked both ways appeared twice; dedupe by
  // item id and sort by slug — the composer output is deterministic.
  const relSeen = new Set<string>();
  const relatedClean = (
    await Promise.all(
      [...rels.outgoing, ...rels.incoming]
        .filter(
          (e) => RELATED_TYPES.has(e.type) && e.item.status === "PUBLISHED",
        )
        .map(async (e) => {
          const v = e.item.publishedVersionId
            ? await store.getVersion(e.item.publishedVersionId)
            : null;
          return {
            itemId: e.item.id,
            slug: e.item.slug,
            title: v?.title ?? e.item.slug,
            type: e.type,
          };
        }),
    )
  )
    .filter((r) => (relSeen.has(r.itemId) ? false : (relSeen.add(r.itemId), true)))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map(({ slug, title, type }) => ({ slug, title, type }));

  const sources: ComposedSource[] = await Promise.all(
    res.items.map(async (h) => ({
      itemId: h.itemId,
      slug: h.slug,
      title: h.title,
      snippet: h.snippet,
      evidence: (await listEvidence(store, h.versionId)).map((e) => ({
        type: e.type,
        uri: PRIVATE_EVIDENCE_TYPES.has(e.type) ? null : e.uri,
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
