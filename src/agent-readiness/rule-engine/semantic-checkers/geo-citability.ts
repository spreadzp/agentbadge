// EPIC-146 (SLICE-146-7): GEO citability checkers — ported from
// packages/agent-readiness-scanner/src/rule-engine/semantic-checkers.ts.
// Keep in sync with the core package implementation.
// Barrel re-export — implementations live in per-checker modules to satisfy
// the 300-line file limit.
import type { SemanticChecker } from "./helpers";
import { checkerAnswerFirst } from "./geo-answer-first";
import { checkerEvidenceDensity } from "./geo-evidence-density";
import { checkerEntityClarity } from "./geo-entity-clarity";
import { checkerServerRendered } from "./geo-server-rendered";
import { checkerAntiCitation } from "./geo-anti-citation";

export const GEO_CITABILITY_CHECKERS: Record<string, SemanticChecker> = {
  answer_first: checkerAnswerFirst,
  evidence_density: checkerEvidenceDensity,
  entity_clarity: checkerEntityClarity,
  server_rendered: checkerServerRendered,
  anti_citation: checkerAntiCitation,
};

export {
  checkerAnswerFirst,
  checkerEvidenceDensity,
  checkerEntityClarity,
  checkerServerRendered,
  checkerAntiCitation,
};
