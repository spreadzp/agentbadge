import type { SectionMeta } from "./profile-schema";
import { isSectionStale } from "./freshness-aggregator";

/**
 * SLICE-101-6: Section Meta Finalizer.
 *
 * Sets `stale` on each section based on freshness computation.
 * Mutates sections in-place (called after all extractors have run).
 */

type SectionWithMeta = { [key: string]: unknown; source: string; confidence: number; verified_at: string; stale: boolean; gaps: string[] };

/**
 * Finalize section meta: set stale flag based on verified_at and source.
 * The `source` field contains comma-separated evidence types or source classes.
 */
export function finalizeSectionMeta(
  sections: Record<string, SectionWithMeta | undefined>,
  now: Date = new Date(),
): void {
  for (const [name, section] of Object.entries(sections)) {
    if (!section) continue;

    // Extract source classes from the source field
    const sourceClasses = section.source
      .split(", ")
      .map((s) => s.trim())
      .filter(Boolean);

    section.stale = isSectionStale(section.verified_at, sourceClasses, now);
  }
}
