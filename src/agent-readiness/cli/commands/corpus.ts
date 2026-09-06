/**
 * SLICE-103-7: `agentbadge corpus` CLI command.
 *
 * Displays corpus stats or exports corpus records.
 * Exit codes: 0 = success, 1 = error
 */

import { registerCommand, type CommandResult, type ParsedArgs, type ParsedFlags } from "../router";
import { BenchmarkApiClient } from "../clients/benchmark-api-client";
import { formatCorpusStatsTable } from "../formatters/benchmark-formatter";
import * as fs from "fs";

const CORPUS_FLAGS = [
  { name: "stats", shortName: "s", type: "boolean" as const, description: "Display corpus statistics" },
  { name: "export", shortName: "e", type: "boolean" as const, description: "Export corpus records as JSON" },
  { name: "from", type: "string" as const, description: "Export: start date (YYYY-MM)" },
  { name: "to", type: "string" as const, description: "Export: end date (YYYY-MM)" },
  { name: "output", shortName: "o", type: "string" as const, description: "Output file path (default: stdout)" },
  { name: "api-url", shortName: "u", type: "string" as const, description: "Override API base URL", default: "http://localhost:4021" },
];

export function registerCorpusCommand(): void {
  registerCommand({
    name: "corpus",
    description: "View corpus statistics or export corpus data",
    args: [],
    flags: CORPUS_FLAGS,
    handler: corpusHandler,
  });
}

async function corpusHandler(_args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const apiUrl = typeof flags["api-url"] === "string" ? flags["api-url"] : "http://localhost:4021";
  const outputPath = typeof flags.output === "string" ? flags.output : undefined;
  const client = new BenchmarkApiClient(apiUrl);

  try {
    if (flags.export === true) {
      const from = typeof flags.from === "string" ? flags.from : undefined;
      const to = typeof flags.to === "string" ? flags.to : undefined;
      const data = await client.exportCorpus(from, to);

      if (outputPath) {
        fs.writeFileSync(outputPath, data);
        return { exitCode: 0, stdout: `Exported corpus to ${outputPath}`, stderr: "" };
      }
      return { exitCode: 0, stdout: data, stderr: "" };
    }

    // Default: show stats
    const stats = await client.getCorpusStats();
    const output = formatCorpusStatsTable(stats);

    if (outputPath) {
      fs.writeFileSync(outputPath, output);
      return { exitCode: 0, stdout: `Stats written to ${outputPath}`, stderr: "" };
    }
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
