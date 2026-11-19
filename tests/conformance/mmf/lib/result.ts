/**
 * SLICE-255-2: unified machine-readable result format (D-255-Q25).
 *
 * Every vector in every track produces one VectorResult:
 *   {schema_version, corpus_version, corpus_sha256, track, vector_id,
 *    result, equivalence, production_path}
 * plus run context (expected/actual, per-dimension equivalence).
 *
 * Own-invariant probes carry source:"own-invariant" and MUST be
 * excluded from MMF metrics (255-5/255-6 rely on the tag).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const RESULT_SCHEMA_VERSION = 1;
export const CORPUS_VERSION = "v0.4.24";

export type ResultStatus =
  | "PASS"
  | "DIVERGENCE-BUG"
  | "DIVERGENCE-MODEL"
  | "NOT_MAPPABLE"
  | "HARNESS_ERROR"
  | "GATE_EXCEPTION";

export type Equivalence = "Exact" | "Partial" | "None";

/** Roll up per-dimension equivalence into the vector-level field —
 *  one rule for every track: all Exact → Exact, any None → None,
 *  otherwise Partial. A vector-level grade must never overstate what
 *  its own dimensions already disclose (independent-review R1). */
export function deriveEquivalence(
  dimensions: Record<string, DimensionNote>,
): Equivalence {
  const vals = Object.values(dimensions);
  if (vals.every((d) => d.equivalence === "Exact")) return "Exact";
  if (vals.some((d) => d.equivalence === "None")) return "None";
  return "Partial";
}

export interface DimensionNote {
  /** Prod mechanism this MMF dimension maps to (null = none). */
  mapped_to: string | null;
  equivalence: Equivalence;
  note?: string;
}

export interface VectorResult {
  schema_version: typeof RESULT_SCHEMA_VERSION;
  corpus_version: typeof CORPUS_VERSION;
  corpus_sha256: string;
  track: "spend" | "lifecycle" | "crypto" | "delegation";
  vector_id: string;
  result: ResultStatus;
  equivalence: Equivalence;
  /** Prod entry point exercised (e.g. "createSpendEnforcer.begin"). */
  production_path: string;
  /** MMF-side expectation (verbatim, scalar-safe). */
  expected: Record<string, unknown>;
  /** What our gate actually did. */
  actual: Record<string, unknown>;
  /** Per-dimension mapping notes (amount_bounds, currency…). */
  dimensions: Record<string, DimensionNote>;
  /** Step-level outcomes for steps-model vectors. */
  steps?: Array<Record<string, unknown>>;
  notes?: string;
  /** Absent or "mmf" for corpus vectors; "own-invariant" for probes. */
  source?: "mmf" | "own-invariant";
}

export function writeTrackResults(
  results: VectorResult[],
  outPath: string,
): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
}

/** Status counts per track — spend-decision metric stays separate
 *  from lifecycle/crypto (never "92/92"). */
export function summarize(results: VectorResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) out[r.result] = (out[r.result] ?? 0) + 1;
  return out;
}
