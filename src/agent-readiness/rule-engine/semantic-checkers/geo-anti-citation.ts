// EPIC-146 (SLICE-146-7): GEO citability checkers — ported from
// packages/agent-readiness-scanner/src/rule-engine/semantic-checkers.ts.
// Keep in sync with the core package implementation.
import type { SemanticChecker } from "./helpers";
import {
  ARTICLE_HINT_RE,
  AUTHOR_SIGNAL_RE,
  countWords,
  CTA_TAG_RE,
  DATE_SIGNAL_RE,
  htmlToText,
  MIN_PAGE_WORDS,
  OVERLAY_RE,
} from "./geo-citability-helpers";

// ─── AB-187 (EPIC-146): Anti-citation disqualifiers ──────────────────────
// Penalty semantics (D6): a page can have every positive lever and still
// not be cited. Detects: overlays sitting over primary content, funnel-grade
// CTA density, content pages missing author/publish date. Any disqualifier →
// partial; overlay (hard disqualifier) or 2+ soft signals → absent.
export const checkerAntiCitation: SemanticChecker = (sources) => {
  const snap = sources.html;
  if (!snap?.body) {
    return { outcome: "no_source", detail: "Homepage HTML snapshot not found" };
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

  const disqualifiers: string[] = [];

  // 1) Overlay over primary content — hard disqualifier
  if (OVERLAY_RE.test(html)) {
    disqualifiers.push("overlay/interstitial over primary content");
  }

  // 2) CTA density: >1 CTA per 60 words on a content page reads like a funnel
  const ctaCount = html.match(CTA_TAG_RE)?.length ?? 0;
  if (ctaCount >= 4 && pageWords / ctaCount < 60) {
    disqualifiers.push(
      `CTA density ${ctaCount} buttons/links per ${pageWords} words (funnel-grade)`,
    );
  }

  // 3) Content page missing attribution (author) or publish date
  const isArticle = ARTICLE_HINT_RE.test(html) || pageWords >= 500;
  if (isArticle) {
    const missing: string[] = [];
    if (!AUTHOR_SIGNAL_RE.test(html)) missing.push("author");
    if (!DATE_SIGNAL_RE.test(html)) missing.push("publish date");
    if (missing.length > 0) {
      disqualifiers.push(`article without ${missing.join(" and ")}`);
    }
  }

  if (disqualifiers.length === 0) {
    return {
      outcome: "found",
      detail: "No anti-citation disqualifiers detected",
    };
  }
  // Overlay alone is a hard disqualifier; 2+ soft signals also fail
  const hard = OVERLAY_RE.test(html) || disqualifiers.length >= 2;
  return {
    outcome: hard ? "absent" : "partial",
    detail: `Anti-citation disqualifier(s): ${disqualifiers.join("; ")}`,
  };
};
