/**
 * SLICE-103-10: Golden benchmark fixtures — 55 records with known scores.
 *
 * Hand-constructed to provide deterministic regression testing.
 * Score distribution is designed to produce known mean, median, and histogram values.
 *
 * Score set (55 records):
 *   10×40, 10×50, 10×60, 10×70, 10×80, 5×90
 *   Mean = (10*40 + 10*50 + 10*60 + 10*70 + 10*80 + 5*90) / 55
 *        = (400 + 500 + 600 + 700 + 800 + 450) / 55
 *        = 3450 / 55 = 62.73 (≈63)
 *   Median = 60 (28th value when sorted)
 *   Histogram buckets (10-point):
 *     40-50: 10, 50-60: 10, 60-70: 10, 70-80: 10, 80-90: 10, 90-100: 5
 */

import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";

function makeRecord(index: number, score: number, category: string, vertical: string): CorpusRecord {
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const id = `01JAR5X7M2K3N4P5Q6R7S8T${String(index).padStart(3, "0")}`;
  return {
    record_id: id,
    timestamp: `2025-06-${String((index % 30) + 1).padStart(2, "0")}T12:00:00Z`,
    ruleset_version: "agent-readiness@1.2.0",
    schema_version: "0.11.0",
    scan_summary: {
      score,
      grade: grade as "A" | "B" | "C" | "D" | "F",
      total_rules: 15,
      applicable_rules: 14,
      status_counts: {
        VERIFIED: Math.floor(score / 10),
        INFERRED: 2,
        GAP: Math.floor((100 - score) / 15),
        CONFLICT: 0,
        NOT_APPLICABLE: 1,
      },
      pillar_scores: { discovery: score + 5, understandability: score - 5 },
    },
    category_scores: {
      [category]: score,
      authentication: Math.max(0, score - 20),
    },
    gap_pattern: {
      gap_ids: [`gap:${category}:pricing`, `gap:authentication:oauth`],
      gap_types: { documentation: 1, authentication: 1 },
      gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 2, LOW: 0 },
    },
    conflict_rules: [],
    industry_vertical: vertical,
    has_runtime_trace: index % 5 === 0,
  };
}

const SCORES = [
  ...Array(10).fill(40),
  ...Array(10).fill(50),
  ...Array(10).fill(60),
  ...Array(10).fill(70),
  ...Array(10).fill(80),
  ...Array(5).fill(90),
];

const CATEGORIES = ["api_description", "authentication", "documentation", "discovery", "understandability"];
const VERTICALS = ["fintech", "healthcare", "ecommerce", "saas", "media"];

export const GOLDEN_RECORDS: CorpusRecord[] = SCORES.map((score, i) =>
  makeRecord(i, score, CATEGORIES[i % CATEGORIES.length], VERTICALS[i % VERTICALS.length]),
);

// ── Hand-computed expected values ────────────────────────────

export const EXPECTED = {
  total_records: 55,
  mean_score: 3450 / 55, // 62.727...
  median_score: 60,
  min_score: 40,
  max_score: 90,
  histogram: {
    "40-50": 10,
    "50-60": 10,
    "60-70": 10,
    "70-80": 10,
    "80-90": 10,
    "90-100": 5,
  },
  grade_distribution: {
    A: 5,
    B: 10,
    C: 10,
    D: 10,
    F: 20,
  },
  verticals: 5,
  categories: 5,
};
