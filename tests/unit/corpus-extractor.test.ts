/**
 * SLICE-103-2: Corpus extractor tests.
 */

import { describe, it, expect } from "vitest";
import { extractCorpusRecord } from "../../src/agent-readiness/corpus/corpus-extractor";
import { sweepForPii } from "../../src/agent-readiness/corpus/pii-sweep";
import { corpusRecordSchema } from "../../src/agent-readiness/corpus/corpus-record.schema";
import { makeMockRuleEngineResult, makeMockScoreResult, makeMockGapSummary } from "./corpus-fixtures";

describe("SLICE-103-2: corpus-extractor", () => {
  it("extracts a valid CorpusRecord from scan results", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
      gapSummary: makeMockGapSummary(),
    });

    expect(record.record_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(record.timestamp).toBeTruthy();
    expect(record.ruleset_version).toBe("agent-readiness@1.2.0");
    expect(record.schema_version).toBe("0.11.0");
  });

  it("maps score and grade correctly", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
    });

    expect(record.scan_summary.score).toBe(72);
    expect(record.scan_summary.grade).toBe("B");
  });

  it("maps status counts correctly", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
    });

    expect(record.scan_summary.status_counts.VERIFIED).toBe(1);
    expect(record.scan_summary.status_counts.GAP).toBe(1);
    expect(record.scan_summary.status_counts.INFERRED).toBe(1);
    expect(record.scan_summary.status_counts.CONFLICT).toBe(0);
  });

  it("maps category scores", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
    });

    expect(record.category_scores.discovery).toBe(80);
    expect(record.category_scores.documentation).toBe(50);
  });

  it("maps gap pattern from gapSummary", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
      gapSummary: makeMockGapSummary(),
    });

    expect(record.gap_pattern.gap_priorities.MEDIUM).toBe(1);
    expect(record.gap_pattern.gap_types.documentation).toBe(1);
  });

  it("extracts gap_ids from GAP assertions", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
    });

    expect(record.gap_pattern.gap_ids).toContain("gap:documentation:AB-002");
  });

  it("extracts conflict_rules from CONFLICT assertions", () => {
    const result = makeMockRuleEngineResult();
    result.assertions[0].status = "CONFLICT";
    const record = extractCorpusRecord({
      result,
      scoreResult: makeMockScoreResult(),
    });

    expect(record.conflict_rules).toContain("AB-001");
  });

  it("produces NO PII (no url, domain, email, IP)", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
      gapSummary: makeMockGapSummary(),
      industryVertical: "fintech",
    });

    const sweep = sweepForPii(record);
    expect(sweep.clean).toBe(true);
  });

  it("passes schema validation", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
      gapSummary: makeMockGapSummary(),
    });

    expect(() => corpusRecordSchema.parse(record)).not.toThrow();
  });

  it("handles missing optional fields", () => {
    const record = extractCorpusRecord({
      result: makeMockRuleEngineResult(),
      scoreResult: makeMockScoreResult(),
    });

    expect(record.industry_vertical).toBeUndefined();
    expect(record.has_runtime_trace).toBe(false);
    expect(record.asr).toBeUndefined();
  });
});
