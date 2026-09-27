// EPIC-146 (SLICE-146-7): GEO citability checkers — ported from
// packages/agent-readiness-scanner/src/rule-engine/semantic-checkers.ts.
// Keep in sync with the core package implementation.
import type { SemanticChecker } from "./helpers";
import {
  countWords,
  DATE_TOKEN_RE,
  htmlToText,
  MIN_PAGE_WORDS,
  numberNearby,
  SOURCE_MARKER_RE,
  SUPERLATIVE_RE,
} from "./geo-citability-helpers";

// ─── AB-184 (EPIC-146): Evidence density ────────────────────────────────
// Princeton GEO study: statistics +33%, quotations +41% visibility.
// A page is citable when it contains facts a model cannot invent:
// named numbers with a source, dates near claims, fact tables/lists,
// attributed quotations. Score: 0 markers = absent, 1–2 = partial,
// 3+ = found. Thin pages (<300 words) → not_applicable.
export const checkerEvidenceDensity: SemanticChecker = (sources) => {
  const snap = sources.html;
  if (!snap?.body) {
    return {
      outcome: "no_source",
      detail: "Homepage HTML snapshot not found",
    };
  }
  const html = snap.body;
  const text = htmlToText(html);
  const pageWords = countWords(text);
  if (pageWords < MIN_PAGE_WORDS) {
    return {
      outcome: "not_applicable",
      detail: `Page has ${pageWords} words (<${MIN_PAGE_WORDS}) — not a content page, rule does not apply`,
    };
  }

  const markers: string[] = [];
  let score = 0;

  // 1) Sourced numbers: source marker with a digit nearby (≤3 points)
  let sourcedNumbers = 0;
  for (const m of text.matchAll(SOURCE_MARKER_RE)) {
    if (numberNearby(text, (m.index ?? 0) + m[0].length)) sourcedNumbers++;
  }
  sourcedNumbers = Math.min(sourcedNumbers, 3);
  if (sourcedNumbers > 0) {
    score += sourcedNumbers;
    markers.push(`${sourcedNumbers} sourced number(s)`);
  }

  // 2) Dates near claims (≤2 points)
  const dateTokens = Math.min(text.match(DATE_TOKEN_RE)?.length ?? 0, 2);
  if (dateTokens > 0) {
    score += dateTokens;
    markers.push(`${dateTokens} dated claim(s)`);
  }

  // 3) Fact structures: <table>/<dl> (≤2 points)
  const factBlocks = Math.min(
    (html.match(/<table[\s>]/gi)?.length ?? 0) +
      (html.match(/<dl[\s>]/gi)?.length ?? 0),
    2,
  );
  if (factBlocks > 0) {
    score += factBlocks;
    markers.push(`${factBlocks} fact table/list(s)`);
  }

  // 4) Attributed quotations: <blockquote> or <cite> (≤2 points)
  const quotes = Math.min(
    (html.match(/<blockquote[\s>]/gi)?.length ?? 0) +
      (html.match(/<cite[\s>]/gi)?.length ?? 0),
    2,
  );
  if (quotes > 0) {
    score += quotes;
    markers.push(`${quotes} attributed quote(s)`);
  }

  const superlatives = text.match(SUPERLATIVE_RE)?.length ?? 0;
  const negNote =
    superlatives > 0 ? `; ${superlatives} unsupported superlative(s)` : "";

  if (score >= 3) {
    return {
      outcome: "found",
      detail: `Evidence density OK (${score} markers: ${markers.join(", ")}${negNote})`,
    };
  }
  if (score >= 1) {
    return {
      outcome: "partial",
      detail: `Thin evidence (${score} marker(s): ${markers.join(", ")}${negNote}) — add named, dated, sourced facts`,
    };
  }
  return {
    outcome: "absent",
    detail: `No citable evidence on a ${pageWords}-word page — generic prose a model can already generate${negNote}`,
  };
};
