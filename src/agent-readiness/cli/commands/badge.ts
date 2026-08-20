/**
 * SLICE-37-8: `agentbadge badge` — SVG Badge Renderer Command
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  registerCommand,
  type ParsedArgs,
  type ParsedFlags,
} from "../router";
import type { AgentReadinessReport } from "../../integrity/report-serializer";

export function registerBadgeCommand(): void {
  registerCommand({
    name: "badge",
    description: "Render an SVG badge from an agent readiness report",
    args: [{ name: "report-path", required: true, description: "Path to the report JSON file" }],
    flags: [
      { name: "output", shortName: "o", type: "string", description: "Output path for SVG file", default: "agentbadge.svg" },
      { name: "label", shortName: "l", type: "string", description: "Custom badge label", default: "agent readiness" },
    ],
    handler: badgeHandler,
  });
}

async function badgeHandler(args: ParsedArgs, flags: ParsedFlags) {
  const reportPath = args.positional[0];
  if (!reportPath) {
    return { exitCode: 1, stdout: "", stderr: "Missing required argument: report-path" };
  }

  const outputPath = typeof flags.output === "string" ? flags.output : "agentbadge.svg";
  const label = typeof flags.label === "string" ? flags.label : "agent readiness";

  try {
    const reportJson = await readFile(reportPath, "utf-8");
    const report = JSON.parse(reportJson) as AgentReadinessReport;

    const score = report.score.overall;
    const svg = renderBadgeSvg(label, score);

    await writeFile(outputPath, svg, "utf-8");

    return {
      exitCode: 0,
      stdout: `Badge written to ${outputPath} (score: ${score}/100)`,
      stderr: "",
      outputFile: outputPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}

export function renderBadgeSvg(label: string, score: number): string {
  const color = score >= 90 ? "#4c1" : score >= 70 ? "#dfb317" : "#e05d44";
  const scoreText = `${score}/100`;
  const labelWidth = Math.max(label.length * 7 + 10, 90);
  const scoreWidth = Math.max(scoreText.length * 7 + 10, 40);
  const totalWidth = labelWidth + scoreWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <rect rx="3" width="${totalWidth}" height="20" fill="#555"/>
  <rect rx="3" x="${labelWidth}" width="${scoreWidth}" height="20" fill="${color}"/>
  <rect x="${labelWidth}" width="4" height="20" fill="${color}"/>
  <rect rx="3" width="${totalWidth}" height="20" fill="url(#b)"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + scoreWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${scoreText}</text>
    <text x="${labelWidth + scoreWidth / 2}" y="14">${scoreText}</text>
  </g>
</svg>`;
}
