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
import { shouldFailCi, shouldFailThreshold, formatFixOutput, formatJsonOutput } from "../output";

const DEFAULT_OUTPUT_PATH = "agentbadge-report.json";

const SCAN_FLAGS = [
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output JSON report to stdout only" },
  { name: "output", shortName: "o", type: "string" as const, description: "Custom output path for report file", default: DEFAULT_OUTPUT_PATH },
  { name: "skip-sign", shortName: "", type: "boolean" as const, description: "Skip Ed25519 signing (dev mode)" },
  { name: "no-cache", shortName: "", type: "boolean" as const, description: "Force refetch all resources" },
  { name: "ci", shortName: "", type: "boolean" as const, description: "CI mode: exit code 1 if any rule fails, suppress colors" },
  { name: "fix", shortName: "", type: "boolean" as const, description: "Output deterministic fix suggestions for failing rules" },
  { name: "diff", shortName: "", type: "string" as const, description: "Compare current scan against previous JSON snapshot" },
  { name: "threshold", shortName: "", type: "string" as const, description: "Fail if score below N (default: 0)" },
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
  const ci = flags.ci === true;
  const fix = flags.fix === true;
  const threshold = typeof flags.threshold === "string" ? parseInt(flags.threshold, 10) : 0;
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
        discovery: 15,
        documentation: 15,
        actionability: 10,
        machine_readable: 10,
        verification: 5,
        content_negotiation: 10,
        payments: 10,
        bazaar: 5,
        openapi: 10,
        skills: 5,
        agents_txt: 5,
        webmcp: 5,
        identity: 5,
        bot_auth: 5,
        infrastructure: 5,
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

    if (fix) {
      const fixOutput = formatFixOutput(ruleEngineResult.assertions as any);
      return { exitCode: 0, stdout: fixOutput, stderr: "" };
    }

    if (json) {
      const jsonOutput = formatJsonOutput(ruleEngineResult.assertions as any);
      return { exitCode: 0, stdout: jsonOutput, stderr: "" };
    }

    // Write report file
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");

    // CI mode: exit 1 if any rule fails
    let exitCode = 0;
    if (ci && shouldFailCi(ruleEngineResult.assertions as any)) {
      exitCode = 1;
    }
    // Threshold check
    if (threshold > 0 && shouldFailThreshold((scoreResult.total as any).score ?? scoreResult.total as any, threshold)) {
      exitCode = 1;
    }

    const prettyOutput = formatPrettyOutput(report);
    return {
      exitCode,
      stdout: `${prettyOutput}\n\nReport written to ${outputPath}`,
      stderr: "",
      outputFile: outputPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
