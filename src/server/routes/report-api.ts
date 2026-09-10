/**
 * SLICE-103-6: Report API — "State of Agent Readiness" report endpoints.
 *
 * GET  /api/reports/state-of-agent-readiness          — list archived reports
 * GET  /api/reports/state-of-agent-readiness/latest    — get latest report (json|markdown)
 * POST /api/reports/state-of-agent-readiness/generate  — trigger report generation
 *
 * SLICE-103-5: Corpus export endpoint.
 * GET  /api/corpus/export                              — export corpus records as JSON
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as fs from "fs";
import * as path from "path";
import { FileCorpusStore } from "../../agent-readiness/corpus/corpus-store";
import {
  generateReport,
  renderReportMarkdown,
  type ReportArchiveEntry,
} from "../../agent-readiness/corpus/report-generator";
import {
  computeOverallBenchmark,
} from "../../agent-readiness/corpus/benchmark-engine";

export const reportRoutes = new Hono();

const store = new FileCorpusStore();
const REPORTS_DIR = path.join(process.cwd(), "data", "corpus", "reports");

// ── Helpers ──────────────────────────────────────────────────

function ensureReportsDir(): void {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function listReportFiles(): string[] {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
}

function readReportEntry(filename: string): { id: string; data: unknown } | null {
  try {
    const filePath = path.join(REPORTS_DIR, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    const id = filename.replace(/\.json$/, "");
    return { id, data };
  } catch {
    return null;
  }
}

// ── GET /api/reports/state-of-agent-readiness — list archived reports ──

reportRoutes.get(
  "/api/reports/state-of-agent-readiness",
  describeRoute({
    tags: ["Reports"],
    summary: "List archived State of Agent Readiness reports",
    description: "Returns a list of all generated reports in the archive, newest first.",
    responses: {
      200: { description: "List of archived reports" },
    },
  }),
  async (c) => {
    const files = listReportFiles();
    const entries: ReportArchiveEntry[] = [];

    for (const file of files) {
      const entry = readReportEntry(file);
      if (entry) {
        const data = entry.data as { title?: string; generated_at?: string; format?: string };
        entries.push({
          id: entry.id,
          title: data.title ?? entry.id,
          date: data.generated_at ?? "",
          format: data.format ?? "json",
        });
      }
    }

    c.header("Cache-Control", "public, max-age=300");
    return c.json(entries);
  },
);

// ── GET /api/reports/state-of-agent-readiness/latest — latest report ──

reportRoutes.get(
  "/api/reports/state-of-agent-readiness/latest",
  describeRoute({
    tags: ["Reports"],
    summary: "Get latest State of Agent Readiness report",
    description: "Returns the most recent report in JSON or markdown format. Use ?format=markdown for markdown output.",
    responses: {
      200: { description: "Latest report content" },
      404: { description: "No reports generated yet" },
    },
  }),
  async (c) => {
    const format = c.req.query("format") === "markdown" ? "markdown" : "json";
    const files = listReportFiles();

    if (files.length === 0) {
      return c.text("No reports have been generated yet.", 404);
    }

    const entry = readReportEntry(files[0]);
    if (!entry) {
      return c.text("Failed to read report.", 404);
    }

    if (format === "markdown") {
      const md = renderReportMarkdown(entry.data as any);
      c.header("Content-Type", "text/markdown; charset=utf-8");
      return c.body(md);
    }

    c.header("Content-Type", "application/json");
    return c.json(entry.data);
  },
);

// ── POST /api/reports/state-of-agent-readiness/generate — generate report ──

reportRoutes.post(
  "/api/reports/state-of-agent-readiness/generate",
  describeRoute({
    tags: ["Reports"],
    summary: "Generate a new State of Agent Readiness report",
    description: "Triggers report generation from current corpus data. Returns the report ID and status.",
    responses: {
      200: { description: "Report generated successfully" },
      503: { description: "Insufficient data to generate report" },
    },
  }),
  async (c) => {
    const records = await store.query({});
    const stats = await store.getStats();

    if (records.length === 0) {
      return c.json({ error: "no_data", message: "Corpus is empty" }, 503);
    }

    // Compute benchmark (may be null if insufficient data)
    const benchmark = computeOverallBenchmark(records, stats);
    const benchmarkData = "insufficient_data" in benchmark ? null : benchmark;

    const report = generateReport(records, stats, benchmarkData);

    // Persist to disk
    ensureReportsDir();
    const filePath = path.join(REPORTS_DIR, `${report.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");

    return c.json({ id: report.id, status: "generated" });
  },
);

// ── GET /api/corpus/export — export corpus records ──

reportRoutes.get(
  "/api/corpus/export",
  describeRoute({
    tags: ["Benchmarks"],
    summary: "Export corpus records as JSON",
    description: "Exports corpus records as a JSON array. Optional date range filters: ?from=YYYY-MM&to=YYYY-MM.",
    responses: {
      200: { description: "Corpus records as JSON array" },
    },
  }),
  async (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");

    const filters: { dateFrom?: string; dateTo?: string } = {};
    if (from) filters.dateFrom = `${from}-01`;
    if (to) {
      // End of month
      const [year, month] = to.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      filters.dateTo = `${to}-${String(lastDay).padStart(2, "0")}`;
    }

    const records = await store.query(filters);
    c.header("Content-Type", "application/json");
    c.header("Cache-Control", "private, max-age=0");
    return c.json(records);
  },
);
