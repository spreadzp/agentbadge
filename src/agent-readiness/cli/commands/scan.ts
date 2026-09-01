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
import { assembleReport } from "../../integrity/report-serializer";
import { AGENT_READINESS_RULESET } from "../../ruleset";
import { formatPrettyOutput } from "../formatters/pretty-output";
import { formatHtmlOutput } from "../formatters/html-output";
import { renderBadgeSvg } from "./badge";
import { shouldFailCi, shouldFailThreshold, formatFixOutput, formatMarkdownOutput } from "../output";
import { computeGrade } from "../../scoring/grade-computer";
import type { Assertion } from "../../rule-engine/assertion-builder";
import { formatJsonApiOutput } from "../formatters/json-api-output";
import { computeFunnel } from "../../scoring/funnel-computer";

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
  { name: "watch", shortName: "w", type: "boolean" as const, description: "Re-run scan every N seconds (default: 30)" },
  { name: "watch-interval", shortName: "", type: "string" as const, description: "Watch interval in seconds (default: 30)" },
  { name: "json-api", shortName: "", type: "boolean" as const, description: "Output full JSON API response (same format as competitor)" },
  { name: "category", shortName: "", type: "string" as const, description: "Run only rules in specified category" },
  { name: "rule", shortName: "", type: "string" as const, description: "Run only a single rule by ID (e.g. AB-001)" },
  { name: "format", shortName: "", type: "string" as const, description: "Output format: text|json|markdown|html|badge (default: text)", default: "text" },
  { name: "fix-hints", shortName: "", type: "boolean" as const, description: "Include fix suggestions in output" },
  { name: "compact", shortName: "", type: "boolean" as const, description: "Compact M2M JSON output (no whitespace)" },
  { name: "report-url", shortName: "", type: "string" as const, description: "Web report URL to include in output" },
  { name: "funnel", shortName: "", type: "boolean" as const, description: "Show readiness funnel in output" },
  { name: "auth-test", shortName: "", type: "boolean" as const, description: "Enable OAuth client_credentials auth probe during scan" },
  { name: "client-id", shortName: "", type: "string" as const, description: "OAuth client_id for auth probe (or CLIENT_ID env var)" },
  { name: "client-secret", shortName: "", type: "string" as const, description: "OAuth client_secret for auth probe (or CLIENT_SECRET env var)" },
  { name: "probe", shortName: "", type: "boolean" as const, description: "Enable endpoint probing during scan" },
  { name: "probe-endpoints", shortName: "", type: "string" as const, description: "Max endpoints to probe (default: 3)", default: "3" },
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
  const jsonApi = flags["json-api"] === true;
  const ci = flags.ci === true;
  const fix = flags.fix === true;
  const fixHints = flags["fix-hints"] === true;
  const compact = flags.compact === true;
  const category = typeof flags.category === "string" ? flags.category : undefined;
  const ruleId = typeof flags.rule === "string" ? flags.rule : undefined;
  const format = typeof flags.format === "string" ? flags.format : "text";
  const reportUrl = typeof flags["report-url"] === "string" ? flags["report-url"] : undefined;
  const threshold = typeof flags.threshold === "string" ? parseInt(flags.threshold, 10) : 0;
  const outputPath = typeof flags.output === "string" ? flags.output : DEFAULT_OUTPUT_PATH;
  const noCache = flags["no-cache"] === true;
  const showFunnel = flags.funnel === true;
  const authTest = flags["auth-test"] === true;
  const clientId = typeof flags["client-id"] === "string" ? flags["client-id"] : process.env.CLIENT_ID;
  const clientSecret = typeof flags["client-secret"] === "string" ? flags["client-secret"] : process.env.CLIENT_SECRET;
  const probe = flags.probe === true;
  const probeEndpoints = typeof flags["probe-endpoints"] === "string" ? parseInt(flags["probe-endpoints"], 10) : 3;

  try {
    // Step 1: Scan domain (Epic 33)
    const sourceState = await scanDomain(url, { noCache, authTest, clientId, clientSecret, probe, probeEndpoints });

    // Step 2: Run rule engine (Epic 34)
    const ruleEngineResult = RuleEngine.run(sourceState);

    // Filter assertions by category or rule_id if requested
    let assertions = ruleEngineResult.assertions as Assertion[];
    if (category) {
      assertions = assertions.filter((a) => a.category === category);
    }
    if (ruleId) {
      assertions = assertions.filter((a) => a.rule_id === ruleId);
    }

    // Step 3: Run scoring engine (Epic 35)
    const manifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      scoring: AGENT_READINESS_RULESET.scoring,
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
        seo_aeo: 5,
        accessibility: 4,
        active_probing: 5,
      },
    };
    const scoreResult = runScoringEngine({
      assertions: ruleEngineResult.assertions as Assertion[],
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
        pillars: scoreResult.pillars,
        delta: scoreResult.delta
          ? { totalDelta: scoreResult.delta.totalDelta ?? 0 }
          : null,
      },
      previousHash: null,
      keyId: "default",
    });

    if (fix) {
      const fixOutput = formatFixOutput(assertions);
      return { exitCode: 0, stdout: fixOutput, stderr: "" };
    }

    if (jsonApi) {
      const scoreVal = scoreResult.total.score ?? 0;
      const grade = scoreResult.total.grade ?? computeGrade(scoreVal);
      const categoryScores = Object.values(scoreResult.categories);
      const funnelData = showFunnel
        ? computeFunnel(Object.fromEntries(
          Object.entries(scoreResult.categories).map(([k, v]) => [k, v.score ?? 0]),
        ))
        : undefined;

      // Extract probe/operational_discovery data from snapshots
      const authProbeData = sourceState.snapshots.auth_probe?.body
        ? JSON.parse(sourceState.snapshots.auth_probe.body)
        : undefined;
      const endpointProbeData = sourceState.snapshots.endpoint_probe?.body
        ? JSON.parse(sourceState.snapshots.endpoint_probe.body)
        : undefined;
      const operationalDiscoveryData = sourceState.snapshots.operational_discovery?.body
        ? JSON.parse(sourceState.snapshots.operational_discovery.body)
        : undefined;

      const apiJson = formatJsonApiOutput({
        url,
        score: scoreVal,
        grade,
        assertions,
        categoryScores,
        compact,
        reportUrl,
        funnel: funnelData,
        authProbe: authProbeData,
        endpointProbe: endpointProbeData,
        operationalDiscovery: operationalDiscoveryData,
        pillars: scoreResult.pillars,
      });
      return { exitCode: 0, stdout: apiJson, stderr: "" };
    }

    if (json || format === "json") {
      const payload = fixHints
        ? assertions.map((r) => ({ ...r, fixHint: r.fix ?? null }))
        : assertions;
      const space = compact ? 0 : 2;
      return { exitCode: 0, stdout: JSON.stringify({ results: payload }, null, space), stderr: "" };
    }

    if (format === "markdown") {
      const scoreVal = scoreResult.total.score;
      const grade = scoreResult.total.grade ?? computeGrade(scoreVal);
      const md = formatMarkdownOutput(assertions, { score: scoreVal, grade, fixHints, reportUrl });
      return { exitCode: 0, stdout: md, stderr: "" };
    }

    if (format === "html") {
      const scoreVal = scoreResult.total.score;
      const grade = scoreResult.total.grade ?? computeGrade(scoreVal);
      const funnelData = showFunnel
        ? computeFunnel(Object.fromEntries(
          Object.entries(scoreResult.categories).map(([k, v]) => [k, v.score ?? 0]),
        ))
        : undefined;
      const html = formatHtmlOutput(assertions, { score: scoreVal, grade, fixHints, reportUrl, funnel: funnelData, pillars: scoreResult.pillars });
      if (outputPath !== DEFAULT_OUTPUT_PATH) {
        await writeFile(outputPath, html, "utf-8");
        return { exitCode: 0, stdout: `HTML report written to ${outputPath}`, stderr: "", outputFile: outputPath };
      }
      return { exitCode: 0, stdout: html, stderr: "" };
    }

    if (format === "badge") {
      const scoreNum = scoreResult.total.score;
      const svg = renderBadgeSvg("agent readiness", scoreNum);
      if (outputPath !== DEFAULT_OUTPUT_PATH) {
        await writeFile(outputPath, svg, "utf-8");
        return { exitCode: 0, stdout: `Badge written to ${outputPath} (score: ${scoreNum}/100)`, stderr: "", outputFile: outputPath };
      }
      return { exitCode: 0, stdout: svg, stderr: "" };
    }

    // Write report file
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");

    // CI mode: exit 1 if any rule fails
    let exitCode = 0;
    if (ci && shouldFailCi(assertions)) {
      exitCode = 1;
    }
    // Threshold check
    if (threshold > 0 && shouldFailThreshold(scoreResult.total.score, threshold)) {
      exitCode = 1;
    }

    const prettyOutput = formatPrettyOutput(report, { showFunnel });
    const reportLine = reportUrl ? `\nWeb report: ${reportUrl}` : "";
    return {
      exitCode,
      stdout: `${prettyOutput}${reportLine}\n\nReport written to ${outputPath}`,
      stderr: "",
      outputFile: outputPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
