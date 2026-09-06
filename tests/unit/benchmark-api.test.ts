/**
 * SLICE-103-5: Benchmark API endpoint tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";

// We test the route handlers directly by importing the app
// and using a temp corpus directory via env override

let tmpDir: string;

function makeRecord(overrides: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    record_id: `01JAR5X7M2K3N4P5Q6R7S8T9V${Math.floor(Math.random() * 900 + 100)}`,
    timestamp: "2025-06-01T12:00:00Z",
    ruleset_version: "agent-readiness@1.2.0",
    schema_version: "0.11.0",
    scan_summary: {
      score: 70,
      grade: "B",
      total_rules: 15,
      applicable_rules: 14,
      status_counts: { VERIFIED: 10, INFERRED: 2, GAP: 1, CONFLICT: 0, NOT_APPLICABLE: 1 },
      pillar_scores: { discovery: 75, understandability: 65 },
    },
    category_scores: { api_description: 80, authentication: 60 },
    gap_pattern: {
      gap_ids: ["gap:api_description:pricing"],
      gap_types: { documentation: 1 },
      gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    },
    conflict_rules: [],
    industry_vertical: "fintech",
    has_runtime_trace: false,
    ...overrides,
  };
}

async function seedRecords(dir: string, count: number) {
  const store = new FileCorpusStore(dir);
  for (let i = 0; i < count; i++) {
    const record = makeRecord({
      record_id: `01JAR5X7M2K3N4P5Q6R7S8T${String(i).padStart(3, "0")}`,
      scan_summary: { ...makeRecord().scan_summary, score: 50 + (i % 50) },
      category_scores: { api_description: 60 + (i % 40), authentication: 40 + (i % 50) },
    });
    await store.append(record);
  }
}

// We need to test the routes with a temp corpus dir.
// Since benchmark-api.ts creates its own store instance, we test
// the underlying functions directly via a test app.

import {
  computeOverallBenchmark,
  computeCategoryBenchmark,
  computePillarBenchmark,
} from "../../src/agent-readiness/corpus/benchmark-engine";
import { InMemoryBenchmarkCache } from "../../src/agent-readiness/corpus/benchmark-cache";

function createTestApp(store: FileCorpusStore) {
  const app = new Hono();
  const cache = new InMemoryBenchmarkCache();
  const CACHE_TTL = 3600;

  app.get("/api/benchmarks", async (c) => {
    const cached = cache.getOverall();
    if (cached) {
      c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
      return c.json(cached);
    }
    const records = await store.query({});
    const stats = await store.getStats();
    const result = computeOverallBenchmark(records, stats, { minSampleSize: 50 });
    if ("insufficient_data" in result) {
      return c.json({ error: "insufficient_data", sample_count: result.sample_count }, 503);
    }
    cache.setOverall(result, CACHE_TTL);
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(result);
  });

  app.get("/api/benchmarks/:category", async (c) => {
    const category = c.req.param("category");
    const cached = cache.getCategory(category);
    if (cached) {
      c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
      return c.json(cached);
    }
    const records = await store.query({});
    const result = computeCategoryBenchmark(records, category, { minSampleSize: 50 });
    if ("insufficient_data" in result) {
      return c.json({ error: "insufficient_data", sample_count: result.sample_count }, 503);
    }
    cache.setCategory(category, result, CACHE_TTL);
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(result);
  });

  app.get("/api/benchmarks/pillars/:pillar", async (c) => {
    const pillar = c.req.param("pillar");
    const records = await store.query({});
    const result = computePillarBenchmark(records, pillar, { minSampleSize: 50 });
    if ("insufficient_data" in result) {
      return c.json({ error: "insufficient_data", sample_count: result.sample_count }, 503);
    }
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(result);
  });

  app.get("/api/corpus/stats", async (c) => {
    const stats = await store.getStats();
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(stats);
  });

  return app;
}

describe("SLICE-103-5: benchmark-api", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "benchmark-api-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/benchmarks returns 503 when <50 records", async () => {
    await seedRecords(tmpDir, 10);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("insufficient_data");
    expect(body.sample_count).toBe(10);
  });

  it("GET /api/benchmarks returns 200 with benchmark data when ≥50 records", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.corpus_stats).toBeDefined();
    expect(body.score_histogram).toBeDefined();
    expect(body.category_benchmarks).toBeDefined();
    expect(body.pillar_benchmarks).toBeDefined();
    expect(body.top_gaps).toBeDefined();
  });

  it("GET /api/benchmarks sets Cache-Control header", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("GET /api/benchmarks/:category returns 503 for insufficient data", async () => {
    await seedRecords(tmpDir, 10);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks/api_description");
    expect(res.status).toBe(503);
  });

  it("GET /api/benchmarks/:category returns 200 with category benchmark", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks/api_description");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category).toBe("api_description");
    expect(body.percentiles).toBeDefined();
    expect(body.common_gaps).toBeDefined();
  });

  it("GET /api/benchmarks/pillars/:pillar returns 200 with pillar benchmark", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks/pillars/discovery");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillar).toBe("discovery");
    expect(body.percentiles).toBeDefined();
  });

  it("GET /api/benchmarks/pillars/:pillar returns 503 for insufficient data", async () => {
    await seedRecords(tmpDir, 10);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/benchmarks/pillars/discovery");
    expect(res.status).toBe(503);
  });

  it("GET /api/corpus/stats returns corpus metadata", async () => {
    await seedRecords(tmpDir, 5);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/corpus/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_records).toBe(5);
    expect(body.date_range).toBeDefined();
    expect(body.ruleset_versions).toBeDefined();
    expect(body.verticals).toBeDefined();
  });

  it("GET /api/corpus/stats sets Cache-Control header", async () => {
    await seedRecords(tmpDir, 5);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/corpus/stats");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("GET /api/corpus/stats returns empty stats for empty corpus", async () => {
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/api/corpus/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_records).toBe(0);
  });
});
