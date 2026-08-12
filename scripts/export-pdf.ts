/**
 * Premium PDF export for Agent Readiness scan reports.
 * Usage: bun scripts/export-pdf.ts <input.json> <output.pdf>
 */

import { readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

interface ScanReport {
  score: { rawScore: number; score: number; floorTriggered: boolean; floorReason: string | null };
  categories: Record<string, { score: number }>;
  assertions: Assertion[];
  fixHints?: (string | null)[];
}

interface Assertion {
  rule_id: string;
  rule_version: string;
  status: string;
  evidence: Evidence[];
  confidence: number;
  timestamp: string;
  source_url: string;
  reason?: string;
  category: string;
  name: string;
  description?: string;
  fix?: { eligible: boolean; type: string; note: string };
}

interface Evidence {
  type: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  content_type: string | null;
}

const COLORS = {
  emerald: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  slate900: "#0f172a",
  slate800: "#1e293b",
  slate700: "#334155",
  slate600: "#475569",
  slate400: "#94a3b8",
  slate300: "#cbd5e1",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
  white: "#ffffff",
};

function statusIcon(status: string): string {
  if (status === "VERIFIED") return "✓";
  if (status === "MISSING") return "✗";
  if (status === "NOT_APPLICABLE") return "—";
  if (status === "WARN") return "⚠";
  return "?";
}

function statusColor(status: string): string {
  if (status === "VERIFIED") return COLORS.emerald;
  if (status === "MISSING") return COLORS.red;
  if (status === "NOT_APPLICABLE") return COLORS.slate400;
  if (status === "WARN") return COLORS.amber;
  return COLORS.slate400;
}

function scoreColor(score: number): string {
  if (score >= 80) return COLORS.emerald;
  if (score >= 50) return COLORS.amber;
  return COLORS.red;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
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
    agents_txt: "agents.txt",
    webmcp: "WebMCP",
    identity: "Identity",
    bot_auth: "Bot Auth",
    infrastructure: "Infrastructure",
  };
  return labels[cat] ?? cat;
}

function generateHTML(report: ScanReport, domain: string): string {
  const totalScore = report.score.score ?? report.score.rawScore;
  const scoreColorVal = scoreColor(totalScore);

  const passed = report.assertions.filter((a) => a.status === "VERIFIED").length;
  const failed = report.assertions.filter((a) => a.status === "MISSING").length;
  const skipped = report.assertions.filter((a) => a.status === "NOT_APPLICABLE").length;

  const categoryCards = Object.entries(report.categories)
    .sort(([, a], [, b]) => b.score - a.score)
    .map(([cat, data]) => {
      const sc = scoreColor(data.score);
      return `
      <div class="cat-card">
        <div class="cat-score-ring" style="border-color: ${sc}">
          <span style="color: ${sc}; font-size: 18px; font-weight: 700;">${data.score.toFixed(0)}</span>
        </div>
        <div class="cat-name">${categoryLabel(cat)}</div>
        <div class="cat-bar-bg">
          <div class="cat-bar-fill" style="width: ${data.score}%; background: ${sc};"></div>
        </div>
      </div>`;
    })
    .join("");

  const assertionsHTML = report.assertions
    .sort((a, b) => {
      const order: Record<string, number> = { MISSING: 0, WARN: 1, VERIFIED: 2, NOT_APPLICABLE: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    })
    .map((a) => {
      const sc = statusColor(a.status);
      const icon = statusIcon(a.status);
      const fixHTML = a.fix?.eligible
        ? `<div class="fix-box"><span class="fix-label">FIX</span> <span class="fix-type">${a.fix.type}</span> — ${a.fix.note}</div>`
        : "";

      const evidenceHTML = a.evidence
        .map(
          (e) =>
            `<div class="evidence-row"><span class="ev-status ${e.status >= 200 && e.status < 300 ? "ev-ok" : "ev-fail"}">${e.status}</span> <span class="ev-url">${e.url}</span></div>`,
        )
        .join("");

      return `
      <div class="assertion-row">
        <div class="as-status" style="background: ${sc}20; color: ${sc};">${icon}</div>
        <div class="as-content">
          <div class="as-header">
            <span class="as-rule">${a.rule_id}</span>
            <span class="as-cat">${categoryLabel(a.category)}</span>
            <span class="as-name">${a.name}</span>
          </div>
          ${a.reason ? `<div class="as-reason">${a.reason}</div>` : ""}
          ${evidenceHTML ? `<div class="evidence-box">${evidenceHTML}</div>` : ""}
          ${fixHTML}
        </div>
      </div>`;
    })
    .join("");

  const now = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background: ${COLORS.slate50}; color: ${COLORS.slate800}; }

  .cover {
    background: linear-gradient(135deg, ${COLORS.slate900} 0%, #1a1f3a 50%, ${COLORS.slate800} 100%);
    color: ${COLORS.white};
    padding: 60px 50px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .cover-brand { font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: ${COLORS.emerald}; font-weight: 600; margin-bottom: 20px; }
  .cover-title { font-size: 42px; font-weight: 800; line-height: 1.15; margin-bottom: 12px; }
  .cover-domain { font-size: 24px; color: ${COLORS.slate300}; font-weight: 400; margin-bottom: 40px; }
  .cover-score-box { display: flex; align-items: center; gap: 30px; margin: 30px 0; }
  .cover-score-ring {
    width: 140px; height: 140px; border-radius: 50%;
    border: 6px solid ${scoreColorVal};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.05);
  }
  .cover-score-num { font-size: 48px; font-weight: 800; color: ${scoreColorVal}; line-height: 1; }
  .cover-score-label { font-size: 11px; color: ${COLORS.slate400}; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .cover-stats { display: flex; gap: 30px; margin-top: 10px; }
  .cover-stat { text-align: center; }
  .cover-stat-num { font-size: 28px; font-weight: 700; }
  .cover-stat-label { font-size: 11px; color: ${COLORS.slate400}; text-transform: uppercase; letter-spacing: 1px; }
  .cover-date { margin-top: 40px; font-size: 13px; color: ${COLORS.slate400}; }
  .cover-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 20px; }

  .page { padding: 40px 50px; min-height: 100vh; background: ${COLORS.white}; }
  .page-title { font-size: 24px; font-weight: 700; color: ${COLORS.slate900}; margin-bottom: 6px; }
  .page-subtitle { font-size: 14px; color: ${COLORS.slate600}; margin-bottom: 24px; }

  .cat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px; }
  .cat-card { background: ${COLORS.slate50}; border: 1px solid ${COLORS.slate200}; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 12px; }
  .cat-score-ring { width: 44px; height: 44px; border-radius: 50%; border: 3px solid; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cat-name { font-size: 13px; font-weight: 600; color: ${COLORS.slate700}; white-space: nowrap; }
  .cat-bar-bg { flex: 1; height: 6px; background: ${COLORS.slate200}; border-radius: 3px; overflow: hidden; }
  .cat-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

  .assertion-row { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid ${COLORS.slate100}; }
  .as-status { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; flex-shrink: 0; }
  .as-content { flex: 1; min-width: 0; }
  .as-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .as-rule { font-size: 12px; font-weight: 700; color: ${COLORS.slate900}; font-family: 'Courier New', monospace; background: ${COLORS.slate100}; padding: 2px 8px; border-radius: 4px; }
  .as-cat { font-size: 11px; color: ${COLORS.slate600}; background: ${COLORS.slate50}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${COLORS.slate200}; }
  .as-name { font-size: 14px; font-weight: 500; color: ${COLORS.slate800}; }
  .as-reason { font-size: 12px; color: ${COLORS.slate600}; margin-bottom: 6px; line-height: 1.5; }
  .evidence-box { background: ${COLORS.slate50}; border-radius: 8px; padding: 8px 12px; margin-top: 6px; }
  .evidence-row { display: flex; align-items: center; gap: 8px; font-size: 11px; font-family: 'Courier New', monospace; padding: 2px 0; }
  .ev-status { padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 10px; }
  .ev-ok { background: ${COLORS.emerald}20; color: ${COLORS.emerald}; }
  .ev-fail { background: ${COLORS.red}20; color: ${COLORS.red}; }
  .ev-url { color: ${COLORS.slate600}; word-break: break-all; }
  .fix-box { margin-top: 8px; padding: 8px 12px; background: ${COLORS.emerald}08; border-left: 3px solid ${COLORS.emerald}; border-radius: 0 8px 8px 0; font-size: 12px; color: ${COLORS.slate700}; line-height: 1.5; }
  .fix-label { font-weight: 700; color: ${COLORS.emerald}; font-size: 10px; letter-spacing: 1px; }
  .fix-type { font-weight: 600; color: ${COLORS.slate900}; }

  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 30px; }
  .summary-card { background: ${COLORS.slate50}; border: 1px solid ${COLORS.slate200}; border-radius: 12px; padding: 20px; text-align: center; }
  .summary-num { font-size: 36px; font-weight: 800; line-height: 1; }
  .summary-label { font-size: 11px; color: ${COLORS.slate600}; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }

  .footer { padding: 20px 50px; background: ${COLORS.slate900}; color: ${COLORS.slate400}; font-size: 11px; text-align: center; }

  @page { margin: 0; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover">
  <div class="cover-brand">AgentBadge — Agent Readiness Report</div>
  <div class="cover-title">Agent Readiness Audit</div>
  <div class="cover-domain">${domain}</div>

  <div class="cover-score-box">
    <div class="cover-score-ring">
      <div class="cover-score-num">${totalScore.toFixed(1)}</div>
      <div class="cover-score-label">/ 100</div>
    </div>
    <div>
      <div style="font-size: 16px; color: ${COLORS.slate300}; margin-bottom: 12px;">Agent Readiness Score</div>
      <div class="cover-stats">
        <div class="cover-stat">
          <div class="cover-stat-num" style="color: ${COLORS.emerald};">${passed}</div>
          <div class="cover-stat-label">Passed</div>
        </div>
        <div class="cover-stat">
          <div class="cover-stat-num" style="color: ${COLORS.red};">${failed}</div>
          <div class="cover-stat-label">Failed</div>
        </div>
        <div class="cover-stat">
          <div class="cover-stat-num" style="color: ${COLORS.slate400};">${skipped}</div>
          <div class="cover-stat-label">N/A</div>
        </div>
        <div class="cover-stat">
          <div class="cover-stat-num" style="color: ${COLORS.white};">${report.assertions.length}</div>
          <div class="cover-stat-label">Total</div>
        </div>
      </div>
    </div>
  </div>

  <div class="cover-badge" style="background: ${scoreColorVal}20; color: ${scoreColorVal};">
    ${totalScore >= 80 ? "Agent Ready" : totalScore >= 50 ? "Partially Ready" : "Not Agent Ready"}
  </div>

  <div class="cover-date">Generated: ${now}<br>Powered by AgentBadge — agentbadge.xyz</div>
</div>

<!-- CATEGORY BREAKDOWN PAGE -->
<div class="page page-break">
  <div class="page-title">Category Breakdown</div>
  <div class="page-subtitle">${report.assertions.length} checks across ${Object.keys(report.categories).length} categories</div>
  <div class="cat-grid">${categoryCards}</div>

  <div class="page-title" style="margin-top: 30px;">Summary</div>
  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-num" style="color: ${COLORS.emerald};">${passed}</div>
      <div class="summary-label">Verified</div>
    </div>
    <div class="summary-card">
      <div class="summary-num" style="color: ${COLORS.red};">${failed}</div>
      <div class="summary-label">Missing</div>
    </div>
    <div class="summary-card">
      <div class="summary-num" style="color: ${COLORS.slate400};">${skipped}</div>
      <div class="summary-label">Not Applicable</div>
    </div>
    <div class="summary-card">
      <div class="summary-num" style="color: ${scoreColorVal};">${totalScore.toFixed(1)}</div>
      <div class="summary-label">Score / 100</div>
    </div>
  </div>
</div>

<!-- DETAILED RESULTS PAGE -->
<div class="page page-break">
  <div class="page-title">Detailed Results</div>
  <div class="page-subtitle">All ${report.assertions.length} assertions sorted by status (failures first)</div>
  ${assertionsHTML}
</div>

<div class="footer">
  AgentBadge — Agency for the Agentic Web · agentbadge.xyz<br>
  Generated ${now} · ${report.assertions.length} checks · Score: ${totalScore.toFixed(1)}/100
</div>

</body>
</html>`;
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error("Usage: bun scripts/export-pdf.ts <input.json> <output.pdf>");
    process.exit(1);
  }

  const raw = await readFile(inputPath, "utf-8");
  const report = JSON.parse(raw) as ScanReport;

  const parsed = new URL(report.assertions[0]?.source_url ?? "https://example.com");
  const domain = parsed.hostname;

  const html = generateHTML(report, domain);

  const tmpHtml = `${process.cwd()}/.report-tmp.html`;
  await writeFile(tmpHtml, html, "utf-8");

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
    timeout: 60_000,
  });

  const page = await browser.newPage();
  await page.goto(`file://${tmpHtml}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();

  const { unlink } = await import("node:fs/promises");
  await unlink(tmpHtml).catch(() => { });

  console.log(`PDF saved: ${outputPath}`);
}

main();
