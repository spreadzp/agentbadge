/**
 * SLICE-37-2: `agentbadge scan` — Full Pipeline Command
 * Orchestrates: scan (Epic 33) → rule engine (Epic 34) → scoring (Epic 35) → serialize + sign (Epic 36)
 */

import { writeFile } from "node:fs/promises";
import {
  registerCommand,
  type CommandResult,
  type ParsedArgs,
  type ParsedFlags,
} from "../router";
import { scanDomain } from "../../scanner/orchestrator";
import { RuleEngine } from "../../rule-engine/rule-engine";
import { runScoringEngine } from "../../scoring/scoring-engine";
import { assembleReport, type AgentReadinessReport } from "../../integrity/report-serializer";
import { AGENT_READINESS_RULESET } from "../../ruleset";
import { formatPrettyOutput } from "../formatters/pretty-output";

const DEFAULT_OUTPUT_PATH = "agentbadge-report.json";

const SCAN_FLAGS = [
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output JSON report to stdout only" },
  { name: "output", shortName: "o", type: "string" as const, description: "Custom output path for report file", default: DEFAULT_OUTPUT_PATH },
  { name: "skip-sign", shortName: "", type: "boolean" as const, description: "Skip Ed25519 signing (dev mode)" },
  { name: "no-cache", shortName: "", type: "boolean" as const, description: "Force refetch all resources" },
];

export function registerScanCommand(): void {
  registerCommand({
    name: "scan",
    description: "Scan a URL for agent readiness and produce a signed report",
    args: [{ name: "url", required: true, description: "Target URL to scan (e.g. https://example.com)" }],
    flags: SCAN_FLAGS,
    handler: scanHandler,
  });
}

async function scanHandler(args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const url = args.positional[0];
  if (!url) {
    return { exitCode: 1, stdout: "", stderr: "Missing required argument: url" };
  }

  const json = flags.json === true;
  const outputPath = typeof flags.output === "string" ? flags.output : DEFAULT_OUTPUT_PATH;
  const noCache = flags["no-cache"] === true;

  try {
    // Step 1: Scan domain (Epic 33)
    const sourceState = await scanDomain(url, { noCache });

    // Step 2: Run rule engine (Epic 34)
    const ruleEngineResult = RuleEngine.run(sourceState);

    // Step 3: Run scoring engine (Epic 35)
    const manifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      categoryWeights: {
        discovery: 25,
        documentation: 25,
        actionability: 20,
        machine_readable: 20,
        verification: 10,
      },
    };
    const scoreResult = runScoringEngine({
      assertions: ruleEngineResult.assertions as any,
      rulesetManifest: manifest,
    });

    // Step 4: Assemble report (Epic 36)
    const parsed = new URL(url);
    const report = assembleReport({
      scope: {
        agent_id: parsed.hostname,
        agent_version: "unknown",
        endpoint_base_url: url,
      },
      sourceState,
      assertions: ruleEngineResult.assertions,
      scoreResult: {
        total: scoreResult.total,
        categories: Object.fromEntries(
          Object.entries(scoreResult.categories).map(([k, v]) => [k, { score: v.score }]),
        ),
        delta: scoreResult.delta
          ? { totalDelta: (scoreResult.delta as any).totalDelta ?? 0 }
          : null,
      },
      previousHash: null,
      keyId: "default",
    });

    if (json) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(report, null, 2),
        stderr: "",
      };
    }

    // Write report file
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");

    const prettyOutput = formatPrettyOutput(report);
    return {
      exitCode: 0,
      stdout: `${prettyOutput}\n\nReport written to ${outputPath}`,
      stderr: "",
      outputFile: outputPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
