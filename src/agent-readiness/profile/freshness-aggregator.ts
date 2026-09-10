import type { Assertion } from "../rule-engine/assertion-builder";
import type { SourceClass } from "../rule-engine/source-hierarchy";

/**
 * SLICE-101-6: Freshness Aggregator.
 *
 * Computes stale status per section based on source-class thresholds.
 * Pure functions — no side effects.
 */

export const FRESHNESS_THRESHOLDS: Record<string, number> = {
  machine_readable_spec: 30,
  website_content: 14,
  official_docs: 60,
  runtime: 7,
  machine_readable_guide: 30,
  ai_inference: 90,
};

export interface FreshnessResult {
  oldest_evidence_days: number;
  stale_sections: string[];
}

/**
 * Compute age in days from a timestamp to now.
 */
export function ageInDays(verifiedAt: string, now: Date = new Date()): number {
  const ts = new Date(verifiedAt).getTime();
  if (isNaN(ts)) return 0;
  return Math.floor((now.getTime() - ts) / (1000 * 60 * 60 * 24));
}

/**
 * Determine if a section is stale based on its verified_at and source_class of evidence.
 */
export function isSectionStale(
  verifiedAt: string,
  sourceClasses: string[],
  now: Date = new Date(),
): boolean {
  const age = ageInDays(verifiedAt, now);
  // Use the most lenient threshold from contributing source classes
  const thresholds = sourceClasses
    .map((sc) => FRESHNESS_THRESHOLDS[sc] ?? 30)
    .filter((t) => t > 0);

  if (thresholds.length === 0) return age > 30; // default threshold
  const maxThreshold = Math.max(...thresholds);
  return age > maxThreshold;
}

/**
 * Aggregate freshness across all sections of a profile.
 * Returns oldest_evidence_days and stale_sections list.
 */
export function aggregateFreshness(
  sections: { name: string; verified_at: string; source_class?: string }[],
  now: Date = new Date(),
): FreshnessResult {
  let oldestDays = 0;
  const staleSections: string[] = [];

  for (const section of sections) {
    const age = ageInDays(section.verified_at, now);
    if (age > oldestDays) oldestDays = age;

    const sourceClasses = section.source_class ? [section.source_class] : [];
    if (isSectionStale(section.verified_at, sourceClasses, now)) {
      staleSections.push(section.name);
    }
  }

  return {
    oldest_evidence_days: oldestDays,
    stale_sections: staleSections,
  };
}
