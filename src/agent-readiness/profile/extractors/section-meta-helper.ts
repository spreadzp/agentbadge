import type { Assertion } from "../../rule-engine/assertion-builder";
import type { SectionMeta } from "../profile-schema";

/**
 * SLICE-101-4: Shared section-meta helper for extractors.
 * Computes source, confidence, verified_at, stale, gaps from applicable assertions.
 */

export function computeSectionMeta(applicable: Assertion[]): SectionMeta {
  const contributing = applicable.filter((a) => a.status === "VERIFIED" || a.status === "INFERRED");

  const confidences = contributing.map((a) => a.confidence).filter((c) => c > 0);
  const confidence = confidences.length > 0
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : 0;

  const sources = new Set<string>();
  for (const a of contributing) {
    for (const e of a.evidence) {
      sources.add(e.type);
    }
  }

  const verifiedAt = applicable
    .map((a) => a.verified_at || a.timestamp)
    .filter(Boolean)
    .sort()
    .pop() ?? new Date().toISOString();

  const gaps = applicable
    .filter((a) => a.status === "GAP")
    .map((a) => a.rule_id);

  return {
    source: Array.from(sources).join(", "),
    confidence,
    verified_at: verifiedAt,
    stale: false,
    gaps,
  };
}

/**
 * Filter assertions by a set of categories.
 */
export function filterByCategories(assertions: Assertion[], categories: string[]): Assertion[] {
  return assertions.filter((a) => categories.includes(a.category));
}
