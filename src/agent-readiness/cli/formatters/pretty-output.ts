/**
 * SLICE-37-3: Pretty Output Formatter — Category Breakdown & Top Issues
 */

import type { AgentReadinessReport } from "../../integrity/report-serializer";
import { computeGrade } from "../../scoring/grade-computer";
import { computeFunnel } from "../../scoring/funnel-computer";
import { renderFunnelAscii } from "./funnel-output";
import { PILLAR_LABELS } from "../../scoring/pillar-map";
import type { PillarScore } from "../../scoring/scoring-types";
import { weightScaledScore, orderedPillars } from "./pillar-helpers";

export interface PrettyOutputOptions {
  showFunnel?: boolean;
}

export function formatPrettyOutput(report: AgentReadinessReport, opts?: PrettyOutputOptions): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("  AgentBadge Scan Report");
  lines.push("═".repeat(60));
  lines.push("");
  lines.push(`  Report ID:  ${report.report_id}`);
  lines.push(`  Scope:      ${report.scope.endpoint_base_url}`);
  lines.push(`  Scanned At: ${report.scanned_at}`);
  lines.push(`  Ruleset:    ${report.ruleset.name} v${report.ruleset.version}`);
  lines.push("");

  // Score section
  lines.push("─".repeat(60));
  lines.push("  Overall Score");
  lines.push("─".repeat(60));
  const score = report.score.overall;
  const grade = computeGrade(score);
  const bar = renderBar(score);
  lines.push(`  ${bar}  ${score}/100  (${grade})`);
  if (report.score.delta !== undefined) {
    const delta = report.score.delta;
    const sign = delta >= 0 ? "+" : "";
    lines.push(`  Delta: ${sign}${delta} from previous scan`);
  }
  lines.push("");

  // Pillars breakdown
  const pillars = report.pillars as Record<string, PillarScore> | undefined;
  if (pillars) {
    lines.push("─".repeat(60));
    lines.push("  PILLARS");
    lines.push("─".repeat(60));
    for (const { key, score: ps } of orderedPillars(pillars)) {
      const label = PILLAR_LABELS[key as keyof typeof PILLAR_LABELS];
      const scaled = weightScaledScore(ps);
      const floorNote = ps.floorTriggered ? " [floor]" : "";
      lines.push(`  ${label.padEnd(20)} ${scaled}/${ps.weight}${floorNote}`);
    }
    lines.push("");
  }

  // Category breakdown
  lines.push("─".repeat(60));
  lines.push("  Category Breakdown");
  lines.push("─".repeat(60));
  const categories = Object.entries(report.score.categories).sort((a, b) => b[1] - a[1]);
  for (const [cat, val] of categories) {
    const catScore = val as number;
    const catBar = renderBar(catScore, 20);
    const pct = Math.round(catScore);
    lines.push(`  ${cat.padEnd(20)} ${catBar} ${catScore}/100  ${pct}%`);
  }
  lines.push("");

  // Funnel section
  if (opts?.showFunnel) {
    const categoryScores: Record<string, number> = {};
    for (const [cat, val] of Object.entries(report.score.categories)) {
      categoryScores[cat] = typeof val === "number" ? val : (val as { score: number }).score ?? 0;
    }
    const funnel = computeFunnel(categoryScores);
    lines.push("─".repeat(60));
    lines.push("  Readiness Funnel");
    lines.push("─".repeat(60));
    lines.push(renderFunnelAscii(funnel));
    lines.push("");
  }

  // Top issues
  const assertions = (report.assertions as Array<{
    rule_id: string;
    status: string;
    reason: string;
    confidence: number;
    category?: string;
    source_url?: string | null;
  }>).filter((a) => a.status === "MISSING" || a.status === "CONFLICT");

  if (assertions.length > 0) {
    lines.push("─".repeat(60));
    lines.push("  Top Issues");
    lines.push("─".repeat(60));
    const sorted = assertions.sort((a, b) => b.confidence - a.confidence);
    const top = sorted.slice(0, 5);
    for (const a of top) {
      lines.push(`  [${a.status}] ${a.rule_id}`);
      lines.push(`    ${a.reason}`);
      if (a.source_url) {
        lines.push(`    Source: ${a.source_url}`);
      }
    }
    lines.push("");
  }

  // Confidence warning
  const lowConfidence = (report.assertions as Array<{ confidence: number; rule_id: string; source_url?: string }>)
    .filter((a) => a.confidence < 0.8);
  if (lowConfidence.length > 0) {
    lines.push("─".repeat(60));
    lines.push("  Low Confidence Assertions (< 0.8)");
    lines.push("─".repeat(60));
    for (const a of lowConfidence.slice(0, 3)) {
      lines.push(`  ${a.rule_id}: confidence=${a.confidence.toFixed(2)}`);
    }
    lines.push("");
  }

  lines.push("═".repeat(60));
  return lines.join("\n");
}

function renderBar(score: number, width = 30): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
