/**
 * SLICE-37-6: `agentbadge fix` — Local-Only Deterministic Fix Generator
 * SLICE-37-7: Fix Output Formatter — Diff Display & Draft File Writer
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  registerCommand,
  type ParsedArgs,
  type ParsedFlags,
} from "../router";
import type { AgentReadinessReport } from "../../integrity/report-serializer";

export interface FixSuggestion {
  rule_id: string;
  severity: "high" | "medium" | "low";
  category: string;
  description: string;
  file: string;
  diff: string;
  rationale: string;
}

export function registerFixCommand(): void {
  registerCommand({
    name: "fix",
    description: "Generate deterministic fix suggestions from a scan report (local-only, no auto-apply)",
    args: [{ name: "report-path", required: true, description: "Path to the report JSON file" }],
    flags: [
      { name: "output", shortName: "o", type: "string", description: "Output path for fix suggestions file", default: "fix-suggestions.json" },
      { name: "dry-run", shortName: "d", type: "boolean", description: "Print suggestions to stdout without writing file" },
      { name: "json", shortName: "j", type: "boolean", description: "Output as JSON" },
    ],
    handler: fixHandler,
  });
}

async function fixHandler(args: ParsedArgs, flags: ParsedFlags) {
  const reportPath = args.positional[0];
  if (!reportPath) {
    return { exitCode: 1, stdout: "", stderr: "Missing required argument: report-path" };
  }

  const dryRun = flags["dry-run"] === true;
  const jsonOutput = flags.json === true;
  const outputPath = typeof flags.output === "string" ? flags.output : "fix-suggestions.json";

  try {
    const reportJson = await readFile(reportPath, "utf-8");
    const report = JSON.parse(reportJson) as AgentReadinessReport;

    const suggestions = generateFixSuggestions(report);

    if (jsonOutput || dryRun) {
      const output = JSON.stringify(suggestions, null, 2);
      if (dryRun) {
        return { exitCode: 0, stdout: output, stderr: "" };
      }
      return { exitCode: 0, stdout: output, stderr: "" };
    }

    await writeFile(outputPath, JSON.stringify(suggestions, null, 2), "utf-8");

    const prettyOutput = formatFixOutput(suggestions, outputPath);
    return { exitCode: 0, stdout: prettyOutput, stderr: "", outputFile: outputPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}

function generateFixSuggestions(report: AgentReadinessReport): FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];
  const assertions = report.assertions as Array<{
    rule_id: string;
    status: string;
    reason: string;
    confidence: number;
    source_url: string | null;
  }>;

  for (const assertion of assertions) {
    if (assertion.status === "MISSING" || assertion.status === "CONFLICT") {
      const suggestion = mapRuleToFix(assertion.rule_id, assertion.reason, assertion.source_url);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }
  }

  return suggestions.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function mapRuleToFix(
  ruleId: string,
  reason: string,
  sourceUrl: string | null,
): FixSuggestion | null {
  const fixMap: Record<string, Omit<FixSuggestion, "rule_id">> = {
    "AB-001": {
      severity: "high",
      category: "discovery",
      description: "Add robots.txt at the site root",
      file: "/robots.txt",
      diff: "--- /dev/null\n+++ /robots.txt\n@@ -0,0 +1,3 @@\n+User-agent: *\n+Allow: /\n+Sitemap: /sitemap.xml",
      rationale: "robots.txt is required for agent discovery and must allow crawler access",
    },
    "AB-002": {
      severity: "high",
      category: "discovery",
      description: "Add sitemap.xml listing agent-accessible endpoints",
      file: "/sitemap.xml",
      diff: "--- /dev/null\n+++ /sitemap.xml\n@@ -0,0 +1,5 @@\n+<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n+<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n+  <url><loc>/agent-guide</loc></url>\n+  <url><loc>/llms.txt</loc></url>\n+</urlset>",
      rationale: "sitemap.xml helps agents discover available resources",
    },
    "AB-003": {
      severity: "high",
      category: "documentation",
      description: "Add agent-guide endpoint with agent metadata",
      file: "/agent-guide",
      diff: "--- /dev/null\n+++ /agent-guide\n@@ -0,0 +1,10 @@\n+{\n+  \"name\": \"Your Agent\",\n+  \"version\": \"1.0.0\",\n+  \"description\": \"Agent description\",\n+  \"capabilities\": [\"text-processing\"],\n+  \"endpoint\": \"/api\",\n+  \"authentication\": { \"type\": \"none\" }\n+}",
      rationale: "agent-guide provides structured metadata for agent consumption",
    },
    "AB-004": {
      severity: "medium",
      category: "machine_readable",
      description: "Add OpenAPI specification at /openapi.json",
      file: "/openapi.json",
      diff: "--- /dev/null\n+++ /openapi.json\n@@ -0,0 +1,8 @@\n+{\n+  \"openapi\": \"3.0.0\",\n+  \"info\": { \"title\": \"API\", \"version\": \"1.0.0\" },\n+  \"paths\": {}\n+}",
      rationale: "OpenAPI spec enables machine-readable API discovery",
    },
    "AB-005": {
      severity: "medium",
      category: "machine_readable",
      description: "Add MCP descriptor at /.well-known/mcp.json",
      file: "/.well-known/mcp.json",
      diff: "--- /dev/null\n+++ /.well-known/mcp.json\n@@ -0,0 +1,5 @@\n+{\n+  \"version\": \"1.0\",\n+  \"capabilities\": [],\n+  \"tools\": []\n+}",
      rationale: "MCP descriptor enables Model Context Protocol integration",
    },
  };

  const fix = fixMap[ruleId];
  if (!fix) return null;

  return { rule_id: ruleId, ...fix };
}

function formatFixOutput(suggestions: FixSuggestion[], outputPath: string): string {
  const lines: string[] = [];
  lines.push("═".repeat(60));
  lines.push("  AgentBadge Fix Suggestions");
  lines.push("═".repeat(60));
  lines.push(`  ${suggestions.length} suggestion(s) generated`);
  lines.push(`  Written to: ${outputPath}`);
  lines.push("");

  for (const s of suggestions) {
    lines.push("─".repeat(60));
    lines.push(`  [${s.severity.toUpperCase()}] ${s.rule_id} — ${s.category}`);
    lines.push(`  ${s.description}`);
    lines.push(`  File: ${s.file}`);
    lines.push("");
    lines.push("  Rationale:");
    lines.push(`    ${s.rationale}`);
    lines.push("");
    lines.push("  Suggested diff:");
    const diffLines = s.diff.split("\n");
    for (const dl of diffLines) {
      lines.push(`    ${dl}`);
    }
    lines.push("");
  }

  lines.push("═".repeat(60));
  lines.push("  NOTE: These are suggestions only. Review and apply manually.");
  lines.push("═".repeat(60));
  return lines.join("\n");
}
