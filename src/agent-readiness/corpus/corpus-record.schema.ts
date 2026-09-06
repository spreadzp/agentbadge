/**
 * SLICE-103-1: Cross-Scan Corpus Record Schema (spec v0.11 §14).
 *
 * Anonymized scan record for the cross-scan corpus.
 * No URL/domain/IP/email — PII swept before appending.
 */

import { z } from "zod";

// ── Sub-schemas ──────────────────────────────────────────────

export const scanSummarySchema = z.object({
  score: z.number().int().min(0).max(100),
  grade: z.enum(["A", "B", "C", "D", "F"]),
  total_rules: z.number().int(),
  applicable_rules: z.number().int(),
  status_counts: z.object({
    VERIFIED: z.number().int(),
    INFERRED: z.number().int(),
    GAP: z.number().int(),
    CONFLICT: z.number().int(),
    NOT_APPLICABLE: z.number().int(),
  }),
  pillar_scores: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

export const gapPatternSchema = z.object({
  gap_ids: z.array(z.string()),
  gap_types: z.record(z.string(), z.number().int()),
  gap_priorities: z.object({
    CRITICAL: z.number().int(),
    HIGH: z.number().int(),
    MEDIUM: z.number().int(),
    LOW: z.number().int(),
  }),
});

// ── Main schema ──────────────────────────────────────────────

export const corpusRecordSchema = z.object({
  record_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  timestamp: z.string().datetime(),
  ruleset_version: z.string(),
  schema_version: z.string(),
  scan_summary: scanSummarySchema,
  category_scores: z.record(z.string(), z.number().min(0).max(100)),
  gap_pattern: gapPatternSchema,
  conflict_rules: z.array(z.string()),
  industry_vertical: z.string().optional(),
  has_runtime_trace: z.boolean(),
  asr: z.number().min(0).max(1).nullable().optional(),
  profile_ref: z.string().nullable().optional(),
  snapshot_ref: z.string().nullable().optional(),
});

// ── Types ────────────────────────────────────────────────────

export type ScanSummary = z.infer<typeof scanSummarySchema>;
export type GapPattern = z.infer<typeof gapPatternSchema>;
export type CorpusRecord = z.infer<typeof corpusRecordSchema>;

// ── Parse function ───────────────────────────────────────────

export function parseCorpusRecord(json: unknown): CorpusRecord {
  return corpusRecordSchema.parse(json);
}
