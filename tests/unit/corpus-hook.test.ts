/**
 * SLICE-103-2: Corpus hook integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { hookScanToCorpus } from "../../src/agent-readiness/corpus/corpus-hook";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import { makeMockRuleEngineResult, makeMockScoreResult, makeMockGapSummary } from "./corpus-fixtures";

let tmpDir: string;

describe("SLICE-103-2: corpus-hook", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-hook-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("successfully hooks a scan result to corpus", async () => {
    const store = new FileCorpusStore(tmpDir);
    const result = await hookScanToCorpus(
      {
        result: makeMockRuleEngineResult(),
        scoreResult: makeMockScoreResult(),
        gapSummary: makeMockGapSummary(),
      },
      store,
    );

    expect(result.success).toBe(true);
    const records = await store.query({});
    expect(records).toHaveLength(1);
  });

  it("is fire-and-forget — does not throw on error", async () => {
    const store = new FileCorpusStore(tmpDir);
    // Pass invalid input that will cause store append to fail (PII in vertical)
    const result = await hookScanToCorpus(
      {
        result: makeMockRuleEngineResult(),
        scoreResult: makeMockScoreResult(),
        industryVertical: "192.168.1.1",
      },
      store,
    );

    // Should not throw — should return success=false
    expect(result.success).toBe(false);
  });

  it("rejects PII records gracefully", async () => {
    const store = new FileCorpusStore(tmpDir);
    const result = await hookScanToCorpus(
      {
        result: makeMockRuleEngineResult(),
        scoreResult: makeMockScoreResult(),
        industryVertical: "https://evil.example.com",
      },
      store,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("PII");
    const records = await store.query({});
    expect(records).toHaveLength(0);
  });

  it("passes optional fields through", async () => {
    const store = new FileCorpusStore(tmpDir);
    const result = await hookScanToCorpus(
      {
        result: makeMockRuleEngineResult(),
        scoreResult: makeMockScoreResult(),
        gapSummary: makeMockGapSummary(),
        industryVertical: "fintech",
        hasRuntimeTrace: true,
        asr: 0.85,
        profileRef: "profile-abc",
        snapshotRef: "snapshot-xyz",
      },
      store,
    );

    expect(result.success).toBe(true);
    const records = await store.query({});
    expect(records[0].industry_vertical).toBe("fintech");
    expect(records[0].has_runtime_trace).toBe(true);
    expect(records[0].asr).toBe(0.85);
    expect(records[0].profile_ref).toBe("profile-abc");
  });
});
