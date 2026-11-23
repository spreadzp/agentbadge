// EPIC-262 (SLICE-262-4): per-surface scoring over findings.
// readiness and exposure are computed INDEPENDENTLY and returned as
// two separate objects — there is intentionally no combined score
// (D-UX-Q3). Deterministic and bounded [0,100]; null when a surface
// produced no evaluable findings (all unknown) — honest "no data",
// not a fake 0 or 100.

import type { IntelFinding, IntelRuleSurface, IntelSeverity } from "./types";

const WEIGHT: Record<IntelSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface SurfaceScore {
  surface: IntelRuleSurface;
  /** null when nothing evaluable — never fabricate a number */
  score: number | null;
  evaluable: number;
  pass: number;
  fail: number;
  warn: number;
  unknown: number;
}

export interface IntelScoreResult {
  ruleset_version: string;
  readiness: SurfaceScore;
  exposure: SurfaceScore;
}

const empty = (surface: IntelRuleSurface): SurfaceScore => ({
  surface,
  score: null,
  evaluable: 0,
  pass: 0,
  fail: 0,
  warn: 0,
  unknown: 0,
});

export function scoreFindings(
  findings: IntelFinding[],
  ruleset_version: string,
): IntelScoreResult {
  const out: IntelScoreResult = {
    ruleset_version,
    readiness: empty("readiness"),
    exposure: empty("exposure"),
  };
  const earned: Record<IntelRuleSurface, number> = {
    readiness: 0,
    exposure: 0,
  };
  const possible: Record<IntelRuleSurface, number> = {
    readiness: 0,
    exposure: 0,
  };
  for (const f of findings) {
    const bucket = out[f.surface];
    bucket[f.status] += 1;
    if (f.status === "unknown") continue;
    bucket.evaluable += 1;
    const w = WEIGHT[f.severity];
    possible[f.surface] += w;
    earned[f.surface] +=
      w * (f.status === "pass" ? 1 : f.status === "warn" ? 0.5 : 0);
  }
  for (const surface of ["readiness", "exposure"] as const) {
    if (possible[surface] > 0) {
      out[surface].score = Math.round(
        (earned[surface] / possible[surface]) * 100,
      );
    }
  }
  return out;
}
