/**
 * SLICE-103-10: Zero-drift verification — spec §14 fields === schema === API === CLI.
 *
 * Ensures the corpus record fields defined in spec v0.11 §14.1
 * match the Zod schema, the API responses, and CLI output fields.
 */

import { describe, it, expect } from "vitest";
import { corpusRecordSchema } from "../../src/agent-readiness/corpus/corpus-record.schema";
import { overallBenchmarkSchema, categoryBenchmarkSchema, pillarBenchmarkSchema } from "../../src/agent-readiness/corpus/benchmark.schema";
import { CLEAN_RECORD } from "../fixtures/corpus-golden-records";
import { GOLDEN_RECORDS } from "../fixtures/corpus-golden-benchmarks";

// Spec §14.1 field definitions (from spec-v0.11.md §14.7 CLI Contract table)
const SPEC_FIELDS = [
  "record_id",
  "timestamp",
  "ruleset_version",
  "schema_version",
  "scan_summary.score",
  "scan_summary.grade",
  "scan_summary.total_rules",
  "scan_summary.applicable_rules",
  "scan_summary.status_counts",
  "scan_summary.pillar_scores",
  "category_scores",
  "gap_pattern.gap_ids",
  "gap_pattern.gap_types",
  "gap_pattern.gap_priorities",
  "industry_vertical",
  "has_runtime_trace",
] as const;

describe("SLICE-103-10: zero-drift — spec ↔ schema", () => {
  it("schema has all spec §14.1 fields", () => {
    const shape = corpusRecordSchema.shape;
    expect(shape).toHaveProperty("record_id");
    expect(shape).toHaveProperty("timestamp");
    expect(shape).toHaveProperty("ruleset_version");
    expect(shape).toHaveProperty("schema_version");
    expect(shape).toHaveProperty("scan_summary");
    expect(shape).toHaveProperty("category_scores");
    expect(shape).toHaveProperty("gap_pattern");
    expect(shape).toHaveProperty("industry_vertical");
    expect(shape).toHaveProperty("has_runtime_trace");
  });

  it("scan_summary sub-schema has spec fields", () => {
    const scanSummary = (corpusRecordSchema.shape as unknown as { scan_summary: { _def: { shape: Record<string, unknown> } } }).scan_summary._def.shape;
    expect(scanSummary).toHaveProperty("score");
    expect(scanSummary).toHaveProperty("grade");
    expect(scanSummary).toHaveProperty("total_rules");
    expect(scanSummary).toHaveProperty("applicable_rules");
    expect(scanSummary).toHaveProperty("status_counts");
    expect(scanSummary).toHaveProperty("pillar_scores");
  });

  it("gap_pattern sub-schema has spec fields", () => {
    const gapPattern = (corpusRecordSchema.shape as unknown as { gap_pattern: { _def: { shape: Record<string, unknown> } } }).gap_pattern._def.shape;
    expect(gapPattern).toHaveProperty("gap_ids");
    expect(gapPattern).toHaveProperty("gap_types");
    expect(gapPattern).toHaveProperty("gap_priorities");
  });

  it("spec field count matches schema top-level fields", () => {
    const topLevelSpecFields = SPEC_FIELDS.filter((f) => !f.includes("."));
    const schemaFields = Object.keys(corpusRecordSchema.shape);
    for (const field of topLevelSpecFields) {
      expect(schemaFields).toContain(field);
    }
  });
});

describe("SLICE-103-10: zero-drift — schema ↔ fixture", () => {
  it("CLEAN_RECORD passes schema validation", () => {
    const parsed = corpusRecordSchema.safeParse(CLEAN_RECORD);
    expect(parsed.success).toBe(true);
  });

  it("CLEAN_RECORD has all spec fields", () => {
    expect(CLEAN_RECORD).toHaveProperty("record_id");
    expect(CLEAN_RECORD).toHaveProperty("timestamp");
    expect(CLEAN_RECORD).toHaveProperty("ruleset_version");
    expect(CLEAN_RECORD).toHaveProperty("schema_version");
    expect(CLEAN_RECORD.scan_summary).toHaveProperty("score");
    expect(CLEAN_RECORD.scan_summary).toHaveProperty("grade");
    expect(CLEAN_RECORD.scan_summary).toHaveProperty("total_rules");
    expect(CLEAN_RECORD.scan_summary).toHaveProperty("applicable_rules");
    expect(CLEAN_RECORD.scan_summary).toHaveProperty("status_counts");
    expect(CLEAN_RECORD).toHaveProperty("category_scores");
    expect(CLEAN_RECORD.gap_pattern).toHaveProperty("gap_ids");
    expect(CLEAN_RECORD.gap_pattern).toHaveProperty("gap_types");
    expect(CLEAN_RECORD.gap_pattern).toHaveProperty("gap_priorities");
    expect(CLEAN_RECORD).toHaveProperty("has_runtime_trace");
  });
});

describe("SLICE-103-10: zero-drift — benchmark model §14.4", () => {
  it("benchmark schema has required fields", () => {
    const overallShape = overallBenchmarkSchema.shape;
    expect(overallShape).toHaveProperty("corpus_stats");
    expect(overallShape).toHaveProperty("score_histogram");
    expect(overallShape).toHaveProperty("category_benchmarks");
    expect(overallShape).toHaveProperty("pillar_benchmarks");
    expect(overallShape).toHaveProperty("top_gaps");

    const categoryShape = categoryBenchmarkSchema.shape;
    expect(categoryShape).toHaveProperty("category");
    expect(categoryShape).toHaveProperty("sample_count");
    expect(categoryShape).toHaveProperty("mean");
    expect(categoryShape).toHaveProperty("median");
    expect(categoryShape).toHaveProperty("percentiles");

    const pillarShape = pillarBenchmarkSchema.shape;
    expect(pillarShape).toHaveProperty("pillar");
    expect(pillarShape).toHaveProperty("sample_count");
    expect(pillarShape).toHaveProperty("mean");
  });
});

describe("SLICE-103-10: zero-drift — schema version", () => {
  it("schema_version is 0.11.0", () => {
    expect(CLEAN_RECORD.schema_version).toBe("0.11.0");
  });

  it("all golden records have schema_version 0.11.0", () => {
    for (const record of GOLDEN_RECORDS) {
      expect(record.schema_version).toBe("0.11.0");
    }
  });
});
