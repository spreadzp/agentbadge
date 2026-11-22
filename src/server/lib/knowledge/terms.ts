/**
 * EPIC-229 (SLICE-229-7): shared query/coverage term extraction —
 * composer confidence, the Postgres OR-tsquery builder (store-db),
 * and the memory scorer all tokenize through ONE function so the
 * two engines see the same term set (Arc R2 M-3 parity fix).
 *
 * Arc R1 M6 + R2 M6: unicode-aware — [^a-z0-9] tokenization deleted
 * every non-ASCII word ("支払い café" → ["caf"]). Letters+numbers+
 * combining marks in any script, ≥2 chars, NFC-normalized first so
 * "café" NFD and NFC produce the same term. Common English
 * interrogatives/stopwords out (they inflate coverage AND would be
 * stripped by tsquery anyway — removing them here keeps an OR
 * tsquery honest).
 */

export const STOPWORDS = new Set([
  "an", "as", "at", "be", "by", "do", "for", "how", "if", "in", "is",
  "it", "of", "on", "or", "so", "the", "to", "up", "we", "a", "i",
  "am", "are", "can", "did", "has", "me", "my", "no", "not", "our",
  "us", "was", "you", "your", "what", "when", "where", "who", "why",
  "does", "and", "with", "that", "this", "from", "about", "into",
]);

export function tokenizeTerms(q: string): string[] {
  return [
    ...new Set(
      (
        q
          .normalize("NFC")
          .toLowerCase()
          .match(/[\p{L}\p{M}\p{N}]{2,}/gu) ?? []
      ).filter((t) => !STOPWORDS.has(t)),
    ),
  ];
}

/** Arc R2 M-3: Postgres OR-tsquery text for a natural-language
 *  query — terms are word-chars only, so `"t1 | t2"` is guaranteed
 *  injection-free before it is bound as a to_tsquery parameter.
 *  Returns undefined when nothing searchable remains (all
 *  stopwords) — callers return [] rather than match the world. */
export function orTsquery(q: string): string | undefined {
  const terms = tokenizeTerms(q);
  return terms.length > 0 ? terms.join(" | ") : undefined;
}

/** Arc R2 M-2: strip engine markup before coverage scoring and
 *  answer composition — ts_headline emits <mark> (from our
 *  sentinel swap) + HTML entities; both would pollute tokens and
 *  leak markup into answerText. Tags first, entities second. */
export function stripHeadlineMarkup(s: string): string {
  return s
    .replace(/<\/?mark>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
