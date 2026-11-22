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
  "am", "are", "can", "did", "has", "me", "my", "our",
  "us", "was", "you", "your", "what", "when", "where", "who", "why",
  "does", "and", "with", "that", "this", "from", "about", "into",
]);

/** Arc R3 M-7: unsegmented scripts need their own lane — the latin
 *  lane's ≥2-char rule dropped 税 entirely and kept 支払いについて
 *  as one unmatchable blob. CJK runs emit bigrams (plus the single
 *  char when the run is one), which the memory scorer can
 *  substring-match and which stay injection-free for to_tsquery.
 *
 *  Arc R4 M-5: Hangul is out of this lane — Korean is space-segmented,
 *  so its words tokenize through the latin lane; keeping it here
 *  double-counted 한국어 as word + both bigrams. Pure-hiragana terms
 *  are dropped too: hiragana-only bigrams are particles/conjugations
 *  (につ, いて) that hit every Japanese document and inflate coverage
 *  into false ANSWERED results. A query made only of particles now
 *  honestly refuses + records a gap. */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
const HIRAGANA_ONLY = /^\p{Script=Hiragana}+$/u;

/** True for terms produced by the CJK lane — scorers substring-match
 *  these (unsegmented text has no word boundary to anchor on). */
export const CJK_TERM =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;

export function cjkTerms(q: string): string[] {
  const out: string[] = [];
  for (const run of q.match(CJK_RUN) ?? []) {
    const chars = [...run];
    if (chars.length === 1) {
      if (!HIRAGANA_ONLY.test(chars[0]!)) out.push(chars[0]!);
      continue;
    }
    for (let i = 0; i + 1 < chars.length; i++) {
      const bg = chars[i]! + chars[i + 1]!;
      if (!HIRAGANA_ONLY.test(bg)) out.push(bg);
    }
  }
  return out;
}

export function tokenizeTerms(q: string): string[] {
  const nfc = q.normalize("NFC").toLowerCase();
  const latin = (nfc.match(/[\p{L}\p{M}\p{N}]{2,}/gu) ?? []).filter(
    (t) => !STOPWORDS.has(t),
  );
  // Cap the term set — a 500-char CJK query would otherwise mint
  // ~500 OR-tsquery terms.
  return [...new Set([...latin, ...cjkTerms(nfc)])].slice(0, 64);
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
