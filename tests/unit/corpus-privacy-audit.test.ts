/**
 * SLICE-103-9: E2E privacy audit test.
 *
 * Tests the full pipeline: write → read → sweep → audit.
 * Verifies that scan results with URLs/domains produce zero-PII corpus records.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import { extractCorpusRecord } from "../../src/agent-readiness/corpus/corpus-extractor";
import { sweepForPii } from "../../src/agent-readiness/corpus/pii-sweep";
import { auditCorpusForPii } from "../../src/agent-readiness/corpus/corpus-audit";
import type { RuleEngineResult } from "../../src/agent-readiness/rule-engine/rule-engine";
import type { ScoreResult } from "../../src/agent-readiness/scoring/scoring-types";

let tmpDir: string;

function makeMockScanResult(): { result: RuleEngineResult; scoreResult: ScoreResult } {
  const result = {
    assertions: [
      { rule_id: "AB-001", status: "VERIFIED", category: "discovery", severity: "info", message: "robots.txt found" },
      { rule_id: "AB-003", status: "VERIFIED", category: "discovery", severity: "info", message: "OpenAPI spec found at https://api.example.com/openapi.json" },
      { rule_id: "AB-007", status: "GAP", category: "understandability", severity: "medium", message: "No llms.txt found" },
    ],
    rulesetVersion: "agent-readiness@1.2.0",
    totalRules: 15,
    applicableRules: 14,
  } as unknown as RuleEngineResult;

  const scoreResult = {
    total: { score: 72, grade: "B", rawScore: 72, floorTriggered: false, floorReason: null },
    pillars: {
      discovery: { pillar: "discovery", weight: 25, rawScore: 75, score: 75, categoryCount: 3, applicableCount: 3, floorTriggered: false },
      understandability: { pillar: "understandability", weight: 25, rawScore: 65, score: 65, categoryCount: 2, applicableCount: 2, floorTriggered: false },
    },
    categories: {
      api_description: { category: "api_description", weight: 15, rawScore: 85, score: 85, ruleCount: 3, applicableCount: 3, floorTriggered: false },
      authentication: { category: "authentication", weight: 10, rawScore: 60, score: 60, ruleCount: 2, applicableCount: 2, floorTriggered: false },
    },
    delta: null,
    config: { categoryWeights: {}, statusContributions: {}, floorCap: 50, floorCategories: [], floorTriggerSeverity: [], scoringModel: "v2-pillars", pillarWeights: {} },
    computedAt: "2025-09-06T12:00:00Z",
  } as unknown as ScoreResult;

  return { result, scoreResult };
}

describe("SLICE-103-9: E2E privacy audit", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-privacy-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extractCorpusRecord produces zero-PII record from scan with URLs", () => {
    const { result, scoreResult } = makeMockScanResult();
    const record = extractCorpusRecord({ result, scoreResult, industryVertical: "fintech" });

    // The record should NOT contain the source URL
    const sweep = sweepForPii(record);
    expect(sweep.clean).toBe(true);
    expect(sweep.findings).toHaveLength(0);
  });

  it("write → read → sweep → audit pipeline produces clean corpus", async () => {
    const store = new FileCorpusStore(tmpDir);
    const { result, scoreResult } = makeMockScanResult();

    // 1. Extract corpus record (anonymized)
    const record = extractCorpusRecord({ result, scoreResult, industryVertical: "fintech" });

    // 2. Sweep for PII before writing
    const preSweep = sweepForPii(record);
    expect(preSweep.clean).toBe(true);

    // 3. Append to store
    await store.append(record);

    // 4. Read back
    const records = await store.query({});
    expect(records).toHaveLength(1);

    // 5. Sweep read-back record
    const postSweep = sweepForPii(records[0]);
    expect(postSweep.clean).toBe(true);

    // 6. Full corpus audit
    const audit = await auditCorpusForPii(store);
    expect(audit.passed).toBe(true);
    expect(audit.total_records).toBe(1);
    expect(audit.clean_records).toBe(1);
    expect(audit.flagged_records).toBe(0);
  });

  it("multiple scans produce clean corpus", async () => {
    const store = new FileCorpusStore(tmpDir);
    const { result, scoreResult } = makeMockScanResult();

    for (let i = 0; i < 5; i++) {
      const record = extractCorpusRecord({
        result,
        scoreResult,
        industryVertical: i % 2 === 0 ? "fintech" : "healthcare",
      });
      await store.append(record);
    }

    const audit = await auditCorpusForPii(store);
    expect(audit.passed).toBe(true);
    expect(audit.total_records).toBe(5);
    expect(audit.clean_records).toBe(5);
  });

  it("corpus audit detects injected PII", async () => {
    const store = new FileCorpusStore(tmpDir);
    const { result, scoreResult } = makeMockScanResult();

    // Write clean records via pipeline
    const record = extractCorpusRecord({ result, scoreResult, industryVertical: "fintech" });
    await store.append(record);

    // Inject a dirty record directly into the file
    const filePath = path.join(tmpDir, "corpus.jsonl");
    const dirtyRecord = {
      ...record,
      record_id: "01JAR5X7M2K3N4P5Q6R7S8T9VX",
      industry_vertical: "https://evil.example.com",
    };
    fs.appendFileSync(filePath, JSON.stringify(dirtyRecord) + "\n");

    const audit = await auditCorpusForPii(store);
    expect(audit.passed).toBe(false);
    expect(audit.flagged_records).toBe(1);
    expect(audit.clean_records).toBe(1);
    expect(audit.findings.some((f) => f.pattern === "URL")).toBe(true);
  });
});
