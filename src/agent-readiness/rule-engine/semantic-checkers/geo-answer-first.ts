// EPIC-146 (SLICE-146-7): GEO citability checkers — ported from
// packages/agent-readiness-scanner/src/rule-engine/semantic-checkers.ts.
// Keep in sync with the core package implementation.
import type { SemanticChecker } from "./helpers";
import {
  ANSWER_MAX_WORDS,
  ANSWER_MIN_WORDS,
  countWords,
  CTA_ONLY_RE,
  extractAnswerBlock,
  extractQuestionHeadings,
  htmlToText,
  MIN_PAGE_WORDS,
  PRONOUN_START_RE,
  REFERENCE_BACK_RE,
} from "./geo-citability-helpers";

// ─── AB-183 (EPIC-146): Answer-first extractability ─────────────────────
// GEO citability heuristic: a page is citable when a question-shaped H2/H3
// heading is immediately followed by a self-contained answer block
// (~80–200 words) that a model can lift without surrounding context.
// Thin pages (<300 words) → not_applicable (D3: don't penalize API-only
// sites / landing stubs).
export const checkerAnswerFirst: SemanticChecker = (sources) => {
  const snap = sources.html;
  if (!snap?.body) {
    return {
      outcome: "no_source",
      detail: "Homepage HTML snapshot not found",
    };
  }
  const html = snap.body;
  const pageWords = countWords(htmlToText(html));
  if (pageWords < MIN_PAGE_WORDS) {
    return {
      outcome: "not_applicable",
      detail: `Page has ${pageWords} words (<${MIN_PAGE_WORDS}) — not a content page, rule does not apply`,
    };
  }
  const questions = extractQuestionHeadings(html);
  if (questions.length === 0) {
    return {
      outcome: "absent",
      detail: `No question-shaped H2/H3 headings on a ${pageWords}-word page`,
    };
  }
  const weakDetails: string[] = [];
  for (const q of questions) {
    const block = extractAnswerBlock(html, q.endIndex);
    const words = countWords(block);
    const failSignals: string[] = [];
    if (words === 0) failSignals.push("empty block");
    if (PRONOUN_START_RE.test(block)) failSignals.push("starts with bare pronoun");
    if (REFERENCE_BACK_RE.test(block)) failSignals.push("references earlier text");
    if (words < ANSWER_MIN_WORDS && CTA_ONLY_RE.test(block))
      failSignals.push("CTA-only");
    const inBand = words >= ANSWER_MIN_WORDS && words <= ANSWER_MAX_WORDS;
    if (inBand && failSignals.length === 0) {
      return {
        outcome: "found",
        detail: `Question heading "${q.text}" is followed by a self-contained ${words}-word answer block`,
      };
    }
    const bandNote = inBand
      ? ""
      : `${words}w out of ${ANSWER_MIN_WORDS}–${ANSWER_MAX_WORDS}w band`;
    const why = [...failSignals, bandNote].filter(Boolean).join(", ");
    weakDetails.push(`"${q.text}" → ${why}`);
  }
  return {
    outcome: "partial",
    detail: `${questions.length} question heading(s) found but none has a valid answer-first block: ${weakDetails.join("; ")}`,
  };
};
