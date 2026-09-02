// ─── Freshness Engine — Spec v0.3 §12.4 ───────────────────────────────────────
// Pure module: computes per-assertion freshness at read/display time.
// Never baked into a live scan — a live scan is always fresh.

import type { Evidence } from "./evidence.types";
import type { Assertion } from "./assertion-builder";
import type { CheckType } from "../shared.schema";
import type { SourceClass } from "./source-hierarchy";
import { strongestSource } from "./source-hierarchy";

export const DEFAULT_FRESHNESS_THRESHOLDS: Record<SourceClass, number> = {
  runtime: 7,
  machine_readable_spec: 30,
  machine_readable_guide: 30,
  official_docs: 60,
  website_content: 14,
  ai_inference: 1,
};

export interface FreshnessResult {
  age_days: number;
  stale: boolean;
}

export function checkFreshness(
  input: {
    verifiedAt: string;
    evidence: Evidence[];
    checkType?: CheckType;
  },
  opts?: {
    now?: Date;
    thresholds?: Record<SourceClass, number>;
  },
): FreshnessResult {
  const now = opts?.now ?? new Date();
  const thresholds = opts?.thresholds ?? DEFAULT_FRESHNESS_THRESHOLDS;

  const verifiedMs = new Date(input.verifiedAt).getTime();
  const ageMs = now.getTime() - verifiedMs;
  const age_days = Math.max(0, Math.floor(ageMs / 86_400_000));

  // GAP (no evidence) → not stale (nothing to age)
  if (input.evidence.length === 0) {
    return { age_days, stale: false };
  }

  // Effective source class = class of strongest evidence
  const strongest = strongestSource(input.evidence, input.checkType);
  if (!strongest) {
    return { age_days, stale: false };
  }

  const threshold = thresholds[strongest.sourceClass] ?? DEFAULT_FRESHNESS_THRESHOLDS[strongest.sourceClass];
  const stale = age_days > threshold;

  return { age_days, stale };
}

export function withFreshness(
  assertion: Assertion,
  opts?: {
    now?: Date;
    thresholds?: Record<SourceClass, number>;
  },
): Assertion & FreshnessResult {
  const freshness = checkFreshness(
    {
      verifiedAt: assertion.verified_at,
      evidence: assertion.evidence,
    },
    opts,
  );
  return { ...assertion, ...freshness };
}
