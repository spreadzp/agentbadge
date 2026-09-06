/**
 * SLICE-103-2: Corpus store tests (file-backed JSONL).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import { extractCorpusRecord } from "../../src/agent-readiness/corpus/corpus-extractor";
import { makeMockRuleEngineResult, makeMockScoreResult, makeMockGapSummary } from "./corpus-fixtures";

let tmpDir: string;

function makeRecord(overrides?: Record<string, unknown>) {
  const record = extractCorpusRecord({
    result: makeMockRuleEngineResult(),
    scoreResult: makeMockScoreResult(),
    gapSummary: makeMockGapSummary(),
  });
  return { ...record, ...overrides };
}

describe("SLICE-103-2: FileCorpusStore", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends a valid record to JSONL file", async () => {
    const store = new FileCorpusStore(tmpDir);
    const record = makeRecord();

    const result = await store.append(record);
    expect(result.success).toBe(true);

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);

    const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).record_id).toBe(record.record_id);
  });

  it("rejects records with PII", async () => {
    const store = new FileCorpusStore(tmpDir);
    const record = makeRecord({ industry_vertical: "https://evil.example.com" });

    const result = await store.append(record);
    expect(result.success).toBe(false);
    expect(result.error).toContain("PII");

    // No file should be written
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it("queries records by date range", async () => {
    const store = new FileCorpusStore(tmpDir);

    await store.append(makeRecord({ timestamp: "2025-01-01T00:00:00Z" }));
    await store.append(makeRecord({ timestamp: "2025-06-01T00:00:00Z" }));
    await store.append(makeRecord({ timestamp: "2025-12-01T00:00:00Z" }));

    const results = await store.query({ dateFrom: "2025-05-01", dateTo: "2025-07-01" });
    expect(results).toHaveLength(1);
    expect(results[0].timestamp).toBe("2025-06-01T00:00:00Z");
  });

  it("queries records by vertical", async () => {
    const store = new FileCorpusStore(tmpDir);

    await store.append(makeRecord({ industry_vertical: "fintech" }));
    await store.append(makeRecord({ industry_vertical: "healthcare" }));
    await store.append(makeRecord({ industry_vertical: "fintech" }));

    const results = await store.query({ vertical: "fintech" });
    expect(results).toHaveLength(2);
  });

  it("queries records by score range", async () => {
    const store = new FileCorpusStore(tmpDir);

    await store.append(makeRecord({ scan_summary: { ...makeRecord().scan_summary, score: 50 } }));
    await store.append(makeRecord({ scan_summary: { ...makeRecord().scan_summary, score: 80 } }));

    const results = await store.query({ minScore: 70 });
    expect(results).toHaveLength(1);
    expect(results[0].scan_summary.score).toBe(80);
  });

  it("respects query limit", async () => {
    const store = new FileCorpusStore(tmpDir);

    for (let i = 0; i < 5; i++) {
      await store.append(makeRecord());
    }

    const results = await store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("getStats returns correct statistics", async () => {
    const store = new FileCorpusStore(tmpDir);

    await store.append(makeRecord({ timestamp: "2025-01-01T00:00:00Z", industry_vertical: "fintech" }));
    await store.append(makeRecord({ timestamp: "2025-06-01T00:00:00Z", industry_vertical: "healthcare" }));

    const stats = await store.getStats();
    expect(stats.total_records).toBe(2);
    expect(stats.date_range.earliest).toBe("2025-01-01T00:00:00Z");
    expect(stats.date_range.latest).toBe("2025-06-01T00:00:00Z");
    expect(stats.verticals).toContain("fintech");
    expect(stats.verticals).toContain("healthcare");
    expect(stats.ruleset_versions).toContain("agent-readiness@1.2.0");
  });

  it("getStats returns empty stats for empty store", async () => {
    const store = new FileCorpusStore(tmpDir);
    const stats = await store.getStats();
    expect(stats.total_records).toBe(0);
  });

  it("returns empty array for non-existent directory", async () => {
    const store = new FileCorpusStore(path.join(tmpDir, "nonexistent"));
    const results = await store.query({});
    expect(results).toEqual([]);
  });
});
