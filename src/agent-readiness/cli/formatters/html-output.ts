/**
 * SLICE-69-7: HTML Output Formatter — Standalone HTML Report
 */

import type { RuleResult } from "../output";

const CATEGORY_LABELS: Record<string, string> = {
  discovery: "Discovery",
  documentation: "Documentation",
  actionability: "Actionability",
  machine_readable: "Machine Readable",
  verification: "Verification",
  content_negotiation: "Content Negotiation",
  payments: "Payments",
  bazaar: "Bazaar",
  openapi: "OpenAPI",
  skills: "Skills",
  agents_txt: "Agents.txt",
  webmcp: "WebMCP",
  identity: "Identity",
  bot_auth: "Bot Auth",
  infrastructure: "Infrastructure",
  seo_aeo: "SEO / AEO",
  accessibility: "Accessibility",
};

function gradeLetter(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function gradeColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 70) return "#eab308";
  return "#ef4444";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface HtmlOutputOptions {
  score?: number;
  grade?: string;
  reportUrl?: string;
  fixHints?: boolean;
}

export function formatHtmlOutput(
  results: RuleResult[],
  opts?: HtmlOutputOptions,
): string {
  const score = opts?.score ?? 0;
  const grade = opts?.grade ?? gradeLetter(score);
  const color = gradeColor(score);
  const reportUrl = opts?.reportUrl;

  const byCategory = new Map<string, RuleResult[]>();
  for (const r of results) {
    const cat = r.category ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(r);
    byCategory.set(cat, list);
  }

  const categorySections: string[] = [];
  for (const [cat, items] of byCategory) {
    const label = CATEGORY_LABELS[cat] ?? cat;
    const passed = items.filter((r) => r.status === "pass").length;
    const total = items.length;

    const rows = items
      .map((r) => {
        const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "○";
        const statusClass = r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "skip";
        const name = escapeHtml(r.name ?? r.rule_id);
        const fixNote = opts?.fixHints && r.fix?.eligible && r.fix?.note
          ? `<div class="fix-note">${escapeHtml(r.fix.note)}</div>`
          : "";
        return `<tr class="${statusClass}"><td class="icon">${icon}</td><td class="rule-id">${escapeHtml(r.rule_id)}</td><td class="rule-name">${name}</td></tr>${fixNote ? `<tr class="fix-row"><td></td><td colspan="2">${fixNote}</td></tr>` : ""}`;
      })
      .join("\n");

    categorySections.push(`
      <section class="category">
        <h2>${escapeHtml(label)} <span class="category-score">${passed}/${total} passed</span></h2>
        <table>
          <thead><tr><th></th><th>Rule</th><th>Name</th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>`);
  }

  const fixSection =
    opts?.fixHints && results.some((r) => r.status === "fail" && r.fix?.eligible)
      ? `
      <section class="fix-suggestions">
        <h2>Fix Suggestions</h2>
        <ul>
          ${results
        .filter((r) => r.status === "fail" && r.fix?.eligible)
        .map(
          (r) =>
            `<li><strong>${escapeHtml(r.rule_id)}</strong>: ${escapeHtml(r.fix?.note ?? "No specific fix note.")}</li>`,
        )
        .join("\n")}
        </ul>
      </section>`
      : "";

  const reportUrlLine = reportUrl
    ? `<p class="report-url"><a href="${escapeHtml(reportUrl)}">View full report →</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Readiness Report</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #1e293b;
      --card-bg: #f8fafc;
      --border: #e2e8f0;
      --pass: #22c55e;
      --fail: #ef4444;
      --skip: #94a3b8;
      --muted: #64748b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --fg: #e2e8f0;
        --card-bg: #1e293b;
        --border: #334155;
        --pass: #4ade80;
        --fail: #f87171;
        --skip: #64748b;
        --muted: #94a3b8;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      padding: 2rem 1rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .score-header {
      text-align: center;
      padding: 2rem;
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      margin-bottom: 2rem;
    }
    .score-value {
      font-size: 3rem;
      font-weight: 700;
      color: ${color};
    }
    .grade-badge {
      display: inline-block;
      font-size: 1.5rem;
      font-weight: 700;
      padding: 0.25rem 1rem;
      border-radius: 8px;
      background: ${color};
      color: #fff;
      margin-left: 0.5rem;
    }
    .score-label {
      color: var(--muted);
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    .category {
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px solid var(--border);
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .category h2 {
      font-size: 1.125rem;
      margin-bottom: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .category-score {
      font-size: 0.875rem;
      color: var(--muted);
      font-weight: 400;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--muted);
    }
    td.icon { width: 1.5rem; text-align: center; font-weight: 700; }
    td.rule-id { font-family: monospace; font-size: 0.875rem; white-space: nowrap; }
    tr.pass .icon { color: var(--pass); }
    tr.fail .icon { color: var(--fail); }
    tr.skip .icon { color: var(--skip); }
    tr.fix-row td { padding-top: 0; padding-bottom: 0.5rem; }
    .fix-note {
      font-size: 0.8125rem;
      color: var(--muted);
      padding: 0.25rem 0.5rem;
      background: var(--bg);
      border-radius: 4px;
      border-left: 3px solid var(--fail);
    }
    .fix-suggestions {
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px solid var(--border);
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .fix-suggestions ul { list-style: none; padding: 0; }
    .fix-suggestions li {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
    }
    .fix-suggestions li:last-child { border-bottom: none; }
    .report-url {
      text-align: center;
      margin-top: 1rem;
    }
    .report-url a {
      color: ${color};
      text-decoration: none;
      font-weight: 500;
    }
    .report-url a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="score-header">
    <div class="score-value">${score}<span style="font-size:1.5rem;color:var(--muted)">/100</span></div>
    <div class="grade-badge">${grade}</div>
    <div class="score-label">Agent Readiness Score</div>
    ${reportUrlLine}
  </div>
  ${categorySections.join("\n")}
  ${fixSection}
</body>
</html>`;
}
