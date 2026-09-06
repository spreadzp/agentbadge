/**
 * SLICE-103-7: CLI report command tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearCommands, runCommand } from "../../src/agent-readiness/cli/router";
import { registerReportCommand } from "../../src/agent-readiness/cli/commands/report";

vi.mock("../../src/agent-readiness/cli/clients/benchmark-api-client", () => ({
  BenchmarkApiClient: vi.fn().mockImplementation(() => ({
    generateReport: vi.fn().mockResolvedValue({ id: "rpt-001", status: "generated" }),
    getReportArchive: vi.fn().mockResolvedValue([
      { id: "rpt-001", title: "State of Agent Readiness Q2 2025", date: "2025-06-01", format: "markdown" },
    ]),
    getLatestReport: vi.fn().mockResolvedValue("# State of Agent Readiness\n\nOverall score: 72"),
    getOverallBenchmark: vi.fn(),
    getCategoryBenchmark: vi.fn(),
    getPillarBenchmark: vi.fn(),
    getCorpusStats: vi.fn(),
    exportCorpus: vi.fn(),
  })),
}));

describe("SLICE-103-7: report CLI command", () => {
  beforeEach(() => {
    clearCommands();
    registerReportCommand();
  });

  afterEach(() => {
    clearCommands();
  });

  it("triggers report generation with --generate", async () => {
    const result = await runCommand(["report", "--generate", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("rpt-001");
    expect(result.stdout).toContain("generated");
  });

  it("lists archived reports with --list", async () => {
    const result = await runCommand(["report", "--list", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Archived Reports");
    expect(result.stdout).toContain("rpt-001");
    expect(result.stdout).toContain("State of Agent Readiness Q2 2025");
  });

  it("fetches latest report with --latest", async () => {
    const result = await runCommand(["report", "--latest", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("State of Agent Readiness");
    expect(result.stdout).toContain("72");
  });

  it("returns error when no action flag specified", async () => {
    const result = await runCommand(["report", "--api-url", "http://localhost:4021"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--generate");
  });
});
