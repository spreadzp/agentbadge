/**
 * SLICE-103-7: CLI benchmarks command tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearCommands, runCommand } from "../../src/agent-readiness/cli/router";
import { registerBenchmarksCommand } from "../../src/agent-readiness/cli/commands/benchmarks";
import {
  formatOverallBenchmarkTable,
  formatCategoryBenchmarkTable,
  formatPillarBenchmarkTable,
} from "../../src/agent-readiness/cli/formatters/benchmark-formatter";
import type { OverallBenchmark, CategoryBenchmark, PillarBenchmark } from "../../src/agent-readiness/corpus/benchmark.schema";

// Mock the BenchmarkApiClient
vi.mock("../../src/agent-readiness/cli/clients/benchmark-api-client", () => ({
  BenchmarkApiClient: vi.fn().mockImplementation(() => ({
    getOverallBenchmark: vi.fn().mockResolvedValue(mockOverall),
    getCategoryBenchmark: vi.fn().mockResolvedValue(mockCategory),
    getPillarBenchmark: vi.fn().mockResolvedValue(mockPillar),
    getCorpusStats: vi.fn(),
    getLatestReport: vi.fn(),
    getReportArchive: vi.fn(),
    generateReport: vi.fn(),
    exportCorpus: vi.fn(),
  })),
}));

const mockOverall: OverallBenchmark = {
  corpus_stats: {
    total_records: 100,
    date_range: { earliest: "2025-01-01T00:00:00Z", latest: "2025-06-01T00:00:00Z" },
    ruleset_versions: ["agent-readiness@1.2.0"],
    verticals: ["fintech"],
  },
  score_histogram: { "70-80": 50, "80-90": 50 },
  category_benchmarks: [],
  pillar_benchmarks: [],
  top_gaps: [{ gap_id: "gap:documentation:llms_txt", frequency: 40, pct: 40.0 }],
};

const mockCategory: CategoryBenchmark = {
  category: "api_description",
  sample_count: 100,
  percentiles: { p25: 60, p50: 70, p75: 80, p90: 90 },
  mean: 72,
  median: 70,
  stddev: 10,
  common_gaps: [{ gap_id: "gap:api_description:pricing", frequency: 30, pct: 30.0 }],
};

const mockPillar: PillarBenchmark = {
  pillar: "discovery",
  sample_count: 100,
  percentiles: { p25: 60, p50: 70, p75: 80, p90: 90 },
  mean: 72,
  median: 70,
};

describe("SLICE-103-7: benchmark formatters", () => {
  it("formatOverallBenchmarkTable produces human-readable output", () => {
    const output = formatOverallBenchmarkTable(mockOverall);
    expect(output).toContain("Overall Benchmark");
    expect(output).toContain("Total Records: 100");
    expect(output).toContain("Score Distribution");
    expect(output).toContain("Top Gaps");
  });

  it("formatCategoryBenchmarkTable produces category output", () => {
    const output = formatCategoryBenchmarkTable(mockCategory);
    expect(output).toContain("Category Benchmark: api_description");
    expect(output).toContain("Sample Count: 100");
    expect(output).toContain("Common Gaps");
  });

  it("formatPillarBenchmarkTable produces pillar output", () => {
    const output = formatPillarBenchmarkTable(mockPillar);
    expect(output).toContain("Pillar Benchmark: discovery");
    expect(output).toContain("Mean:");
    expect(output).toContain("P90:");
  });
});

describe("SLICE-103-7: benchmarks CLI command", () => {
  beforeEach(() => {
    clearCommands();
    registerBenchmarksCommand();
  });

  afterEach(() => {
    clearCommands();
  });

  it("fetches overall benchmarks in table format", async () => {
    const result = await runCommand(["benchmarks", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Overall Benchmark");
  });

  it("fetches overall benchmarks in JSON format", async () => {
    const result = await runCommand(["benchmarks", "--json", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.corpus_stats.total_records).toBe(100);
  });

  it("fetches category benchmark with --category flag", async () => {
    const result = await runCommand(["benchmarks", "--category", "api_description", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Category Benchmark: api_description");
  });

  it("fetches pillar benchmark with --pillar flag", async () => {
    const result = await runCommand(["benchmarks", "--pillar", "discovery", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Pillar Benchmark: discovery");
  });

  it("returns exit code 2 on insufficient data (503)", async () => {
    const { BenchmarkApiClient } = await import("../../src/agent-readiness/cli/clients/benchmark-api-client");
    (BenchmarkApiClient as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() => ({
      getOverallBenchmark: vi.fn().mockRejectedValue(new Error("API 503: insufficient data")),
      getCategoryBenchmark: vi.fn(),
      getPillarBenchmark: vi.fn(),
      getCorpusStats: vi.fn(),
      getLatestReport: vi.fn(),
      getReportArchive: vi.fn(),
      generateReport: vi.fn(),
      exportCorpus: vi.fn(),
    }));

    const result = await runCommand(["benchmarks", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Insufficient data");
  });
});
