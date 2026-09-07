/**
 * SLICE-103-9: Corpus-wide PII audit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import { auditCorpusForPii } from "../../src/agent-readiness/corpus/corpus-audit";
import {
  CLEAN_RECORD,
  RECORD_WITH_URL,
  RECORD_WITH_EMAIL,
  RECORD_WITH_IP,
} from "../fixtures/corpus-golden-records";

let tmpDir: string;

describe("SLICE-103-9: corpus-audit", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-audit-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns passed=true for empty corpus", async () => {
    const store = new FileCorpusStore(tmpDir);
    const result = await auditCorpusForPii(store);
    expect(result.passed).toBe(true);
    expect(result.total_records).toBe(0);
    expect(result.clean_records).toBe(0);
    expect(result.flagged_records).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("returns passed=true for clean corpus", async () => {
    const store = new FileCorpusStore(tmpDir);
    await store.append(CLEAN_RECORD);
    await store.append({ ...CLEAN_RECORD, record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V1" });
    await store.append({ ...CLEAN_RECORD, record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V2" });

    const result = await auditCorpusForPii(store);
    expect(result.passed).toBe(true);
    expect(result.total_records).toBe(3);
    expect(result.clean_records).toBe(3);
    expect(result.flagged_records).toBe(0);
  });

  it("returns passed=false for corpus with PII", async () => {
    const store = new FileCorpusStore(tmpDir);
    await store.append(CLEAN_RECORD);
    // We need to bypass the store's PII check to insert dirty records
    // Write directly to the JSONL file
    const filePath = path.join(tmpDir, "corpus.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(RECORD_WITH_URL) + "\n");

    const result = await auditCorpusForPii(store);
    expect(result.passed).toBe(false);
    expect(result.total_records).toBe(2);
    expect(result.flagged_records).toBe(1);
    expect(result.clean_records).toBe(1);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings[0].record_id).toBe(RECORD_WITH_URL.record_id);
  });

  it("returns findings with record_id, field, and pattern", async () => {
    const store = new FileCorpusStore(tmpDir);
    const filePath = path.join(tmpDir, "corpus.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(RECORD_WITH_EMAIL) + "\n");

    const result = await auditCorpusForPii(store);
    expect(result.passed).toBe(false);
    expect(result.findings[0]).toHaveProperty("record_id");
    expect(result.findings[0]).toHaveProperty("field");
    expect(result.findings[0]).toHaveProperty("pattern");
  });

  it("flags multiple dirty records", async () => {
    const store = new FileCorpusStore(tmpDir);
    await store.append(CLEAN_RECORD);
    const filePath = path.join(tmpDir, "corpus.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(RECORD_WITH_URL) + "\n");
    fs.appendFileSync(filePath, JSON.stringify(RECORD_WITH_EMAIL) + "\n");
    fs.appendFileSync(filePath, JSON.stringify(RECORD_WITH_IP) + "\n");

    const result = await auditCorpusForPii(store);
    expect(result.passed).toBe(false);
    expect(result.total_records).toBe(4);
    expect(result.flagged_records).toBe(3);
    expect(result.clean_records).toBe(1);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
  });
});
