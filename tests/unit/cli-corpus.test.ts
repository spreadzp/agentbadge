/**
 * SLICE-103-7: CLI corpus command tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearCommands, runCommand } from "../../src/agent-readiness/cli/router";
import { registerCorpusCommand } from "../../src/agent-readiness/cli/commands/corpus";
import { formatCorpusStatsTable } from "../../src/agent-readiness/cli/formatters/benchmark-formatter";
import type { CorpusStats } from "../../src/agent-readiness/corpus/corpus-store";

const mockStats: CorpusStats = {
  total_records: 150,
  date_range: { earliest: "2025-01-01T00:00:00Z", latest: "2025-06-01T00:00:00Z" },
  ruleset_versions: ["agent-readiness@1.2.0"],
  verticals: ["fintech", "healthcare"],
};

vi.mock("../../src/agent-readiness/cli/clients/benchmark-api-client", () => ({
  BenchmarkApiClient: vi.fn().mockImplementation(() => ({
    getCorpusStats: vi.fn().mockResolvedValue(mockStats),
    exportCorpus: vi.fn().mockResolvedValue(JSON.stringify([{ record_id: "test" }])),
    getOverallBenchmark: vi.fn(),
    getCategoryBenchmark: vi.fn(),
    getPillarBenchmark: vi.fn(),
    getLatestReport: vi.fn(),
    getReportArchive: vi.fn(),
    generateReport: vi.fn(),
  })),
}));

describe("SLICE-103-7: corpus stats formatter", () => {
  it("formatCorpusStatsTable produces readable output", () => {
    const output = formatCorpusStatsTable(mockStats);
    expect(output).toContain("Corpus Statistics");
    expect(output).toContain("Total Records:     150");
    expect(output).toContain("fintech, healthcare");
  });
});

describe("SLICE-103-7: corpus CLI command", () => {
  beforeEach(() => {
    clearCommands();
    registerCorpusCommand();
  });

  afterEach(() => {
    clearCommands();
  });

  it("displays corpus stats by default", async () => {
    const result = await runCommand(["corpus", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Corpus Statistics");
    expect(result.stdout).toContain("150");
  });

  it("exports corpus data with --export flag", async () => {
    const result = await runCommand(["corpus", "--export", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("record_id");
  });

  it("exports corpus data with date range", async () => {
    const result = await runCommand(["corpus", "--export", "--from", "2025-01", "--to", "2025-06", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("record_id");
  });
});
