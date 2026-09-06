/**
 * SLICE-103-2: Corpus extractor — extracts anonymized CorpusRecord from scan results.
 *
 * Pure function, no side effects. Produces no URL/domain/IP/email.
 */

import { generateReportId } from "../integrity/ulid";
import type { RuleEngineResult } from "../rule-engine/rule-engine";
import type { ScoreResult } from "../scoring/scoring-types";
import type { GapSummary } from "../gap-engine/gap-engine";
import type { CorpusRecord } from "./corpus-record.schema";

export interface CorpusExtractionInput {
  result: RuleEngineResult;
  scoreResult: ScoreResult;
  gapSummary?: GapSummary;
  industryVertical?: string;
  hasRuntimeTrace?: boolean;
  asr?: number | null;
  profileRef?: string | null;
  snapshotRef?: string | null;
}

export function extractCorpusRecord(input: CorpusExtractionInput): CorpusRecord {
  const { result, scoreResult, gapSummary } = input;

  // 1. Extract status counts from assertions
  const status_counts = {
    VERIFIED: 0,
    INFERRED: 0,
    GAP: 0,
    CONFLICT: 0,
    NOT_APPLICABLE: 0,
  };
  for (const a of result.assertions) {
    if (a.status in status_counts) {
      status_counts[a.status as keyof typeof status_counts]++;
    }
  }

  // 2. Extract pillar scores
  const pillar_scores: Record<string, number> = {};
  for (const [pillar, score] of Object.entries(scoreResult.pillars)) {
    pillar_scores[pillar] = score.score;
  }

  // 3. Extract category scores
  const category_scores: Record<string, number> = {};
  for (const [category, score] of Object.entries(scoreResult.categories)) {
    category_scores[category] = score.score;
  }

  // 4. Extract gap pattern
  const gap_ids: string[] = [];
  const gap_types: Record<string, number> = {};
  if (gapSummary) {
    for (const [type, count] of Object.entries(gapSummary.by_type)) {
      if (count > 0) gap_types[type] = count;
    }
  }
  // Extract gap_ids from assertions with GAP status
  for (const a of result.assertions) {
    if (a.status === "GAP") {
      gap_ids.push(`gap:${a.category}:${a.rule_id}`);
    }
  }

  const gap_priorities = gapSummary
    ? { ...gapSummary.by_priority }
    : { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

  // 5. Extract conflict rules
  const conflict_rules: string[] = [];
  for (const a of result.assertions) {
    if (a.status === "CONFLICT") {
      conflict_rules.push(a.rule_id);
    }
  }

  // 6. Build the record
  return {
    record_id: generateReportId(),
    timestamp: new Date().toISOString(),
    ruleset_version: result.rulesetVersion,
    schema_version: "0.11.0",
    scan_summary: {
      score: scoreResult.total.score,
      grade: scoreResult.total.grade as "A" | "B" | "C" | "D" | "F",
      total_rules: result.totalRules,
      applicable_rules: result.applicableRules,
      status_counts,
      pillar_scores: Object.keys(pillar_scores).length > 0 ? pillar_scores : undefined,
    },
    category_scores,
    gap_pattern: {
      gap_ids,
      gap_types,
      gap_priorities,
    },
    conflict_rules,
    industry_vertical: input.industryVertical,
    has_runtime_trace: input.hasRuntimeTrace ?? false,
    asr: input.asr ?? undefined,
    profile_ref: input.profileRef ?? undefined,
    snapshot_ref: input.snapshotRef ?? undefined,
  };
}
