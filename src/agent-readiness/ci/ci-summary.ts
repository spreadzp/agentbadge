/**
 * SLICE-39-3: CI Summary Formatter — Markdown for GitHub Actions job log
 */

import type { AgentReadinessReport } from "../integrity/report-serializer";

interface Assertion {
  rule_id: string;
  status: string;
  reason: string;
  confidence: number;
  category?: string;
  severity?: string;
  source_url?: string | null;
}

export function formatCiSummary(report: AgentReadinessReport): string {
  const lines: string[] = [];
  const score = report.score.overall ?? (report.score as Record<string, unknown>).total as number ?? 0;
  const scoreEmoji = score >= 90 ? "🟢" : score >= 70 ? "🟡" : "🔴";

  lines.push("## 🏷️ AgentBadge Scan Results");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Overall Score** | ${scoreEmoji} **${score}/100** |`);
  lines.push(`| **Scope** | \`${report.scope.endpoint_base_url}\` |`);
  lines.push(`| **Ruleset** | ${report.ruleset.name} v${report.ruleset.version} |`);
  lines.push(`| **Report ID** | \`${report.report_id}\` |`);
  lines.push(`| **Scanned At** | ${report.scanned_at} |`);

  if (report.score.delta !== undefined && report.score.delta !== null) {
    const delta = report.score.delta as number;
    const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
    const deltaEmoji = delta > 0 ? "📈" : delta < 0 ? "📉" : "➡️";
    lines.push(`| **Delta** | ${deltaEmoji} ${deltaStr} |`);
  }

  lines.push("");

  // Category breakdown
  const categories = Object.entries(report.score.categories).sort(
    (a, b) => (b[1] as number) - (a[1] as number),
  );

  if (categories.length > 0) {
    lines.push("### Category Breakdown");
    lines.push("");
    lines.push("| Category | Score | Status |");
    lines.push("|----------|-------|--------|");
    for (const [cat, val] of categories) {
      const catScore = val as number;
      const status = catScore >= 90 ? "🟢 Pass" : catScore >= 70 ? "🟡 Warn" : "🔴 Fail";
      lines.push(`| ${cat} | ${catScore}/100 | ${status} |`);
    }
    lines.push("");
  }

  // Issues (MISSING / CONFLICT / FAIL)
  const assertions = (report.assertions as Assertion[]).filter(
    (a) => a.status === "MISSING" || a.status === "CONFLICT" || a.status === "FAIL",
  );

  if (assertions.length > 0) {
    lines.push("### Issues Found");
    lines.push("");
    const sorted = assertions.sort((a, b) => b.confidence - a.confidence);
    for (const a of sorted.slice(0, 10)) {
      const severity = a.severity ? ` **[${a.severity.toUpperCase()}]**` : "";
      lines.push(`- **[${a.status}]** \`${a.rule_id}\`${severity} — ${a.reason}`);
    }
    if (assertions.length > 10) {
      lines.push(`- _...and ${assertions.length - 10} more_`);
    }
    lines.push("");
  }

  // Regressions (delta < 0)
  if (report.score.delta !== undefined && (report.score.delta as number) < 0) {
    lines.push("### ⚠️ Regression Detected");
    lines.push("");
    lines.push(`Score dropped by ${Math.abs(report.score.delta as number)} points from the previous scan.`);
    lines.push("");
  }

  // Low confidence assertions
  const lowConfidence = (report.assertions as Assertion[]).filter((a) => a.confidence < 0.8);
  if (lowConfidence.length > 0) {
    lines.push("<details>");
    lines.push("<summary>Low Confidence Assertions</summary>");
    lines.push("");
    for (const a of lowConfidence.slice(0, 5)) {
      lines.push(`- \`${a.rule_id}\`: confidence=${a.confidence.toFixed(2)}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("---");
  lines.push(`[Full Report](${report.report_id}) · [AgentBadge](https://agentbadge.dev)`);

  return lines.join("\n");
}
