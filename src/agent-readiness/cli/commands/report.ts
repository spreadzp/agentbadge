/**
 * SLICE-103-7: `agentbadge report` CLI command.
 *
 * Generates, lists, or fetches State of Agent Readiness reports.
 * Exit codes: 0 = success, 1 = error
 */

import { registerCommand, type CommandResult, type ParsedArgs, type ParsedFlags } from "../router";
import { BenchmarkApiClient } from "../clients/benchmark-api-client";

const REPORT_FLAGS = [
  { name: "generate", shortName: "g", type: "boolean" as const, description: "Trigger report generation" },
  { name: "list", shortName: "l", type: "boolean" as const, description: "List archived reports" },
  { name: "latest", type: "boolean" as const, description: "Get latest report" },
  { name: "format", shortName: "f", type: "string" as const, description: "Report format: json|markdown (default: markdown)", default: "markdown" },
  { name: "output", shortName: "o", type: "string" as const, description: "Output file path (default: stdout)" },
  { name: "api-url", shortName: "u", type: "string" as const, description: "Override API base URL", default: "http://localhost:4021" },
];

export function registerReportCommand(): void {
  registerCommand({
    name: "report",
    description: "Generate, list, or fetch State of Agent Readiness reports",
    args: [],
    flags: REPORT_FLAGS,
    handler: reportHandler,
  });
}

async function reportHandler(_args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const apiUrl = typeof flags["api-url"] === "string" ? flags["api-url"] : "http://localhost:4021";
  const format = typeof flags.format === "string" ? flags.format : "markdown";
  const outputPath = typeof flags.output === "string" ? flags.output : undefined;
  const client = new BenchmarkApiClient(apiUrl);

  try {
    if (flags.generate === true) {
      const result = await client.generateReport();
      const msg = `Report generation triggered: ${result.id} (status: ${result.status})`;
      if (outputPath) {
        return { exitCode: 0, stdout: msg, stderr: "" };
      }
      return { exitCode: 0, stdout: msg, stderr: "" };
    }

    if (flags.list === true) {
      const entries = await client.getReportArchive();
      const lines = entries.map((e) => `${e.id}  ${e.date}  ${e.title}  [${e.format}]`);
      const output = `Archived Reports (${entries.length}):\n${lines.join("\n")}`;
      if (outputPath) {
        const fs = await import("fs");
        fs.writeFileSync(outputPath, output);
        return { exitCode: 0, stdout: `Report list written to ${outputPath}`, stderr: "" };
      }
      return { exitCode: 0, stdout: output, stderr: "" };
    }

    if (flags.latest === true) {
      const content = await client.getLatestReport(format as "json" | "markdown");
      if (outputPath) {
        const fs = await import("fs");
        fs.writeFileSync(outputPath, content);
        return { exitCode: 0, stdout: `Report written to ${outputPath}`, stderr: "" };
      }
      return { exitCode: 0, stdout: content, stderr: "" };
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: "Error: specify --generate, --list, or --latest\nUsage: agentbadge report --generate | --list | --latest [--format json|markdown] [--output <path>]",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
