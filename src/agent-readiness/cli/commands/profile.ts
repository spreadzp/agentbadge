/**
 * SLICE-101-8: CLI `profile` command.
 *
 * agentbadge profile --url <url> [--format json|markdown|yaml] [--output <path>] [--report <file>]
 *
 * --url: run fresh scan → build profile
 * --report: read existing scan report JSON → build profile (takes precedence)
 * --format: json (default), markdown, yaml
 * --output: file path; if omitted, stdout
 *
 * Exit codes: 0 = success, 1 = error, 2 = stale sections warning (profile still generated)
 */

import { registerCommand, type CommandResult, type ParsedArgs, type ParsedFlags } from "../router";
import { buildProfile } from "../../profile/profile-builder";
import { renderProfileMarkdown } from "../../profile/renderers/markdown-renderer";
import { renderProfileYaml } from "../../profile/renderers/yaml-renderer";
import { scanDomain } from "../../scanner/orchestrator";
import { RuleEngine } from "../../rule-engine/rule-engine";
import { runScoringEngine } from "../../scoring/scoring-engine";
import { assembleReport } from "../../integrity/report-serializer";
import { AGENT_READINESS_RULESET } from "../../ruleset";
import type { Assertion } from "../../rule-engine/assertion-builder";
import type { ScanReport } from "../../report-formatter";
import * as fs from "fs";

const PROFILE_FLAGS = [
  { name: "url", shortName: "u", type: "string" as const, description: "Target URL to scan (e.g. https://example.com)" },
  { name: "report", shortName: "r", type: "string" as const, description: "Path to existing scan report JSON" },
  { name: "format", shortName: "f", type: "string" as const, description: "Output format: json|markdown|yaml (default: json)", default: "json" },
  { name: "output", shortName: "o", type: "string" as const, description: "Output file path (default: stdout)" },
];

export function registerProfileCommand(): void {
  registerCommand({
    name: "profile",
    description: "Generate a Knowledge Profile from a scan or existing report",
    args: [],
    flags: PROFILE_FLAGS,
    handler: profileHandler,
  });
}

async function profileHandler(_args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const url = typeof flags.url === "string" ? flags.url : undefined;
  const reportPath = typeof flags.report === "string" ? flags.report : undefined;
  const format = typeof flags.format === "string" ? flags.format : "json";
  const outputPath = typeof flags.output === "string" ? flags.output : undefined;

  if (!url && !reportPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Error: either --url or --report is required.\nUsage: agentbadge profile --url <url> [--format json|markdown|yaml] [--output <path>]\n       agentbadge profile --report <file> [--format json|markdown|yaml] [--output <path>]",
    };
  }

  try {
    let scanReport: ScanReport;
    let assertions: Assertion[];
    let scoreResult: any;
    let reportId: string | undefined;

    if (reportPath) {
      const raw = fs.readFileSync(reportPath, "utf-8");
      const parsed = JSON.parse(raw);

      if (parsed.scanReport && parsed.assertions) {
        scanReport = parsed.scanReport;
        assertions = parsed.assertions;
        scoreResult = parsed.scoreResult;
        reportId = parsed.reportId;
      } else if (parsed.report && parsed.assertions) {
        scanReport = parsed.report;
        assertions = parsed.assertions;
        scoreResult = parsed.scoreResult;
        reportId = parsed.report_id;
      } else {
        scanReport = parsed;
        assertions = parsed.assertions ?? [];
      }
    } else {
      // Run fresh scan
      const sourceState = await scanDomain(url!, {});
      const ruleEngineResult = RuleEngine.run(sourceState);
      assertions = ruleEngineResult.assertions as Assertion[];

      const manifest = {
        name: AGENT_READINESS_RULESET.name,
        version: AGENT_READINESS_RULESET.version,
        scoring: AGENT_READINESS_RULESET.scoring,
        categoryWeights: {
          discovery: 15, documentation: 15, actionability: 10,
          machine_readable: 10, verification: 5, content_negotiation: 10,
          payments: 10, bazaar: 5, openapi: 10, skills: 5,
          agents_txt: 5, webmcp: 5, identity: 5, bot_auth: 5,
          infrastructure: 5, seo_aeo: 5, accessibility: 4, active_probing: 5,
        },
      };

      scoreResult = runScoringEngine({
        assertions: ruleEngineResult.assertions as Assertion[],
        rulesetManifest: manifest as any,
      });

      const parsedUrl = new URL(url!);
      const report = assembleReport({
        scope: {
          agent_id: parsedUrl.hostname,
          agent_version: "unknown",
          endpoint_base_url: url!,
        },
        sourceState,
        assertions: ruleEngineResult.assertions,
        scoreResult: {
          total: scoreResult.total,
          categories: Object.fromEntries(
            Object.entries(scoreResult.categories).map(([k, v]) => [k, { score: v.score }]),
          ),
          pillars: scoreResult.pillars,
          delta: scoreResult.delta ? { totalDelta: scoreResult.delta.totalDelta ?? 0 } : null,
        },
        previousHash: null,
        keyId: "default",
      });

      scanReport = report as unknown as ScanReport;
    }

    const profile = buildProfile({ scanReport, assertions, scoreResult, reportId });

    let output: string;
    switch (format) {
      case "markdown":
        output = renderProfileMarkdown(profile);
        break;
      case "yaml":
        output = renderProfileYaml(profile);
        break;
      case "json":
      default:
        output = JSON.stringify(profile, null, 2);
        break;
    }

    if (outputPath) {
      fs.writeFileSync(outputPath, output, "utf-8");
    }

    const hasStaleSections = profile.freshness.stale_sections.length > 0;
    const exitCode = hasStaleSections ? 2 : 0;
    const stderr = hasStaleSections
      ? `Warning: profile has stale sections: ${profile.freshness.stale_sections.join(", ")}`
      : "";

    return {
      exitCode,
      stdout: outputPath ? "" : output,
      stderr,
      outputFile: outputPath,
    };
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Error: ${String(err)}`,
    };
  }
}
