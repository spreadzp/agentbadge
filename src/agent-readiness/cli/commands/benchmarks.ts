/**
 * SLICE-103-7: `agentbadge benchmarks` CLI command.
 *
 * Queries benchmark API and displays results in table or JSON format.
 * Exit codes: 0 = success, 1 = error, 2 = insufficient data
 */

import { registerCommand, type CommandResult, type ParsedArgs, type ParsedFlags } from "../router";
import { BenchmarkApiClient } from "../clients/benchmark-api-client";
import {
  formatOverallBenchmarkTable,
  formatCategoryBenchmarkTable,
  formatPillarBenchmarkTable,
} from "../formatters/benchmark-formatter";

const BENCHMARKS_FLAGS = [
  { name: "category", shortName: "c", type: "string" as const, description: "Get benchmark for specific category" },
  { name: "pillar", shortName: "p", type: "string" as const, description: "Get benchmark for specific pillar" },
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output as JSON (default: table)" },
  { name: "api-url", shortName: "u", type: "string" as const, description: "Override API base URL", default: "http://localhost:4021" },
];

export function registerBenchmarksCommand(): void {
  registerCommand({
    name: "benchmarks",
    description: "Query agent readiness industry benchmarks",
    args: [],
    flags: BENCHMARKS_FLAGS,
    handler: benchmarksHandler,
  });
}

async function benchmarksHandler(_args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const apiUrl = typeof flags["api-url"] === "string" ? flags["api-url"] : "http://localhost:4021";
  const category = typeof flags.category === "string" ? flags.category : undefined;
  const pillar = typeof flags.pillar === "string" ? flags.pillar : undefined;
  const asJson = flags.json === true;

  const client = new BenchmarkApiClient(apiUrl);

  try {
    if (category) {
      const bench = await client.getCategoryBenchmark(category);
      return { exitCode: 0, stdout: asJson ? JSON.stringify(bench, null, 2) : formatCategoryBenchmarkTable(bench), stderr: "" };
    }

    if (pillar) {
      const bench = await client.getPillarBenchmark(pillar);
      return { exitCode: 0, stdout: asJson ? JSON.stringify(bench, null, 2) : formatPillarBenchmarkTable(bench), stderr: "" };
    }

    const bench = await client.getOverallBenchmark();
    return { exitCode: 0, stdout: asJson ? JSON.stringify(bench, null, 2) : formatOverallBenchmarkTable(bench), stderr: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("503")) {
      return { exitCode: 2, stdout: "", stderr: `Insufficient data: ${msg}` };
    }
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
