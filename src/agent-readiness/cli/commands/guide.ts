/**
 * SLICE-69-9: `agentbadge guide` — Markdown Improvement Guide Generator
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
import type { RulesetManifest } from "../../scoring/scoring-config";
import { AGENT_READINESS_RULESET } from "../../ruleset";
import { computeGrade } from "../../scoring/grade-computer";
import type { Assertion } from "../../rule-engine/assertion-builder";

export interface GuideInput {
  url: string;
  score: number;
  grade: string;
  assertions: Assertion[];
  ruleSeverityMap?: Record<string, string>;
  ruleFixMap?: Record<string, string>;
  ruleExampleMap?: Record<string, string>;
  categoryFilter?: string;
}

export function registerGuideCommand(): void {
  registerCommand({
    name: "guide",
    description: "Generate a markdown improvement guide for a URL",
    args: [{ name: "url", required: true, description: "Target URL to scan" }],
    flags: [
      { name: "output", shortName: "o", type: "string", description: "Output path for guide markdown", default: "improvement-guide.md" },
      { name: "category", shortName: "c", type: "string", description: "Only include rules in specified category" },
    ],
    handler: guideHandler,
  });
}

async function guideHandler(args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const url = args.positional[0];
  if (!url) {
    return { exitCode: 1, stdout: "", stderr: "Missing required argument: url" };
  }

  const outputPath = typeof flags.output === "string" ? flags.output : "improvement-guide.md";
  const categoryFilter = typeof flags.category === "string" ? flags.category : undefined;

  try {
    const sourceState = await scanDomain(url, {});
    const ruleEngineResult = RuleEngine.run(sourceState);
    const assertions = ruleEngineResult.assertions as Assertion[];

    const manifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      scoring: AGENT_READINESS_RULESET.scoring,
      categoryWeights: {},
    };

    const scoreResult = runScoringEngine({
      assertions,
      rulesetManifest: manifest as unknown as RulesetManifest,
    });

    const score = scoreResult.total.score ?? 0;
    const grade = scoreResult.total.grade ?? computeGrade(score);

    const ruleSeverityMap: Record<string, string> = {};
    const ruleFixMap: Record<string, string> = {};
    for (const rule of AGENT_READINESS_RULESET.rules as readonly { rule_id: string; severity: string; fix?: { note?: string } }[]) {
      ruleSeverityMap[rule.rule_id] = rule.severity;
      if (rule.fix?.note) {
        ruleFixMap[rule.rule_id] = rule.fix.note;
      }
    }

    const md = generateGuideMarkdown({
      url,
      score,
      grade,
      assertions,
      ruleSeverityMap,
      ruleFixMap,
      categoryFilter,
    });

    if (outputPath !== "improvement-guide.md" || flags.output !== undefined) {
      await writeFile(outputPath, md, "utf-8");
      return { exitCode: 0, stdout: `Guide written to ${outputPath}`, stderr: "", outputFile: outputPath };
    }

    return { exitCode: 0, stdout: md, stderr: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}

export function generateGuideMarkdown(input: GuideInput): string {
  const lines: string[] = [];
  const generatedAt = new Date().toISOString();

  lines.push("# Agent Readiness Improvement Guide");
  lines.push("");
  lines.push(`**URL:** ${input.url}  `);
  lines.push(`**Score:** ${input.score}/100 (${input.grade})  `);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push("");

  let failing = input.assertions.filter(
    (a) => a.status === "GAP" || a.status === "CONFLICT",
  );

  if (input.categoryFilter) {
    failing = failing.filter((a) => a.category === input.categoryFilter);
  }

  if (failing.length === 0) {
    lines.push("No failing rules found. Your site is agent-ready!");
    return lines.join("\n");
  }

  const severityOrder = ["high", "medium", "low"];
  const severityLabels: Record<string, string> = {
    high: "High Priority",
    medium: "Medium Priority",
    low: "Low Priority",
  };

  const grouped: Record<string, Assertion[]> = { high: [], medium: [], low: [] };
  for (const a of failing) {
    const severity = input.ruleSeverityMap?.[a.rule_id] ?? "medium";
    if (!grouped[severity]) grouped[severity] = [];
    grouped[severity].push(a);
  }

  for (const sev of severityOrder) {
    const items = grouped[sev];
    if (!items || items.length === 0) continue;

    lines.push(`## ${severityLabels[sev]}`);
    lines.push("");

    for (const a of items) {
      lines.push(`### ${a.rule_id}: ${a.name ?? a.rule_id}`);
      lines.push(`**Problem:** ${a.reason}  `);
      const fixNote = input.ruleFixMap?.[a.rule_id];
      if (fixNote) {
        lines.push(`**Fix:** ${fixNote}`);
      }
      lines.push("");
      const example = input.ruleExampleMap?.[a.rule_id];
      if (example) {
        lines.push("**Example:**");
        lines.push("");
        lines.push(example);
        lines.push("");
      }
      if (a.source_url) {
        lines.push(`*Source: ${a.source_url}*`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
