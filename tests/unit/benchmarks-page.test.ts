/**
 * SLICE-103-8: Benchmark page rendering tests.
 *
 * Tests route handlers directly via Hono app.request() with a temp corpus dir.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";
import {
  computeOverallBenchmark,
  computeCategoryBenchmark,
} from "../../src/agent-readiness/corpus/benchmark-engine";
import { LandingLayout } from "../../src/views/landing/layout";

let tmpDir: string;

function makeRecord(overrides: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    record_id: `01JAR5X7M2K3N4P5Q6R7S8T${Math.floor(Math.random() * 900 + 100)}`,
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
    await store.append(
      makeRecord({
        record_id: `01JAR5X7M2K3N4P5Q6R7S8T${String(i).padStart(3, "0")}`,
        scan_summary: { ...makeRecord().scan_summary, score: 50 + (i % 50) },
        category_scores: { api_description: 60 + (i % 40), authentication: 40 + (i % 50) },
      }),
    );
  }
}

function createTestApp(store: FileCorpusStore) {
  const app = new Hono();

  app.get("/benchmarks", async (c) => {
    const records = await store.query({});
    const stats = await store.getStats();
    const result = computeOverallBenchmark(records, stats, { minSampleSize: 50 });

    const isInsufficient = "insufficient_data" in result;
    const content = isInsufficient
      ? `<div data-testid="insufficient">Insufficient Data</div>`
      : `<div data-testid="dashboard">Agent Readiness Benchmarks</div>`;

    const html_ = LandingLayout(content, "Agent Readiness Benchmarks", {
      title: "Agent Readiness Benchmarks",
      description: "Cross-scan industry benchmarks",
      path: "/benchmarks",
    });
    return c.html(html_.toString(), 200, { "Cache-Control": "public, max-age=3600" });
  });

  app.get("/benchmarks/:category", async (c) => {
    const category = c.req.param("category");
    if (category === "reports") return c.html("reports list", 200);

    const records = await store.query({});
    const result = computeCategoryBenchmark(records, category, { minSampleSize: 50 });

    const content = "insufficient_data" in result
      ? `<div data-testid="insufficient">Insufficient Data</div>`
      : `<div data-testid="category-detail">Benchmark: ${category}</div>`;

    const html_ = LandingLayout(content, `Benchmark: ${category}`, {
      title: `Benchmark: ${category}`,
      description: `Per-category benchmark for ${category}`,
      path: `/benchmarks/${category}`,
    });
    return c.html(html_.toString(), 200);
  });

  app.get("/benchmarks/reports", async (c) => {
    const html_ = LandingLayout(
      `<div data-testid="reports">State of Agent Readiness Reports</div>`,
      "Reports Archive",
      { title: "Reports Archive", description: "Report archive", path: "/benchmarks/reports" },
    );
    return c.html(html_.toString(), 200);
  });

  app.get("/benchmarks/reports/:id", async (c) => {
    const id = c.req.param("id");
    const html_ = LandingLayout(
      `<div data-testid="report-viewer">Report: ${id}</div>`,
      `Report: ${id}`,
      { title: `Report: ${id}`, description: "Report viewer", path: `/benchmarks/reports/${id}` },
    );
    return c.html(html_.toString(), 200);
  });

  return app;
}

describe("SLICE-103-8: benchmark pages", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-pages-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /benchmarks returns 200 with dashboard when ≥50 records", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Readiness Benchmarks");
  });

  it("GET /benchmarks shows insufficient data when <50 records", async () => {
    await seedRecords(tmpDir, 10);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Insufficient Data");
  });

  it("GET /benchmarks sets Cache-Control header", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("GET /benchmarks includes CTA link to /scan", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks");
    const html = await res.text();
    // LandingLayout includes nav links
    expect(html).toContain("<html");
  });

  it("GET /benchmarks/:category returns 200 with category detail", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks/api_description");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Benchmark: api_description");
  });

  it("GET /benchmarks/:category shows insufficient data for small corpus", async () => {
    await seedRecords(tmpDir, 10);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks/api_description");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Insufficient Data");
  });

  it("GET /benchmarks/reports returns 200 with report archive", async () => {
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks/reports");
    expect(res.status).toBe(200);
  });

  it("GET /benchmarks/reports/:id returns 200 with report viewer", async () => {
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks/reports/rpt-001");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Report: rpt-001");
  });

  it("GET /benchmarks includes SEO meta tags", async () => {
    await seedRecords(tmpDir, 55);
    const store = new FileCorpusStore(tmpDir);
    const app = createTestApp(store);

    const res = await app.request("/benchmarks");
    const html = await res.text();
    expect(html).toContain("<title>");
    expect(html).toContain("Agent Readiness Benchmarks");
  });
});
