import { describe, it, expect } from "vitest";

import {
  collectStats,
  formatTelegramReport,
  formatTextReport,
} from "../src/server/lib/report/traffic-format";

const row = (
  path: string,
  status = 200,
  ua = "curl/8.0",
  hoursAgo = 1,
): { payload: Record<string, unknown>; createdAt: string } => ({
  payload: { method: "GET", path, status, durationMs: 5, ua },
  createdAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
});

describe("traffic-format — SLICE-203-13", () => {
  it("collectStats aggregates totals/classes/paths/errors", () => {
    const stats = collectStats(
      [row("/a"), row("/a"), row("/b", 404), row("/c", 500)],
      24,
    );
    expect(stats.total).toBe(4);
    expect(stats.byClass.get("2xx")).toBe(2);
    expect(stats.byClass.get("4xx")).toBe(1);
    expect(stats.byClass.get("5xx")).toBe(1);
    expect(stats.byPath.get("/a")).toBe(2);
    expect(stats.errors.size).toBe(2);
  });

  it("collectStats buckets UA into bot classes", () => {
    const stats = collectStats(
      [row("/x", 200, "facebookexternalhit/1.1"), row("/x", 200, "Mozilla/5.0")],
      24,
    );
    expect(stats.byUaClass.get("Facebook")).toBe(1);
    expect(stats.byUaClass.get("Human/other")).toBe(1);
  });

  it("formatTelegramReport emits <b> sections and <pre> tables", () => {
    const stats = collectStats([row("/a"), row("/b", 404)], 24);
    const html = formatTelegramReport(stats);
    expect(html).toContain("<b>AgentBadge traffic report</b>");
    expect(html).toContain("<pre>");
    expect(html).toContain("/a");
  });

  it("formatTelegramReport escapes < > & in paths", () => {
    const stats = collectStats([row("/a?<script>&x=1")], 24);
    const html = formatTelegramReport(stats);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("formatTelegramReport stays within 4096 chars", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      row(`/some/very/long/path/number-${i}-with-padding-${"x".repeat(40)}`, 404),
    );
    const stats = collectStats(rows, 24);
    const html = formatTelegramReport(stats);
    expect(html.length).toBeLessThanOrEqual(4096);
  });

  it("formatTelegramReport handles empty stats", () => {
    const stats = collectStats([], 24);
    const html = formatTelegramReport(stats);
    expect(html).toContain("Total requests: 0");
    expect(html.length).toBeLessThanOrEqual(4096);
  });

  it("formatTextReport keeps legacy plain-text shape", () => {
    const stats = collectStats([row("/a"), row("/b", 404)], 24);
    const text = formatTextReport(stats);
    expect(text).toContain("Total requests: 2");
    expect(text).toContain("Status classes:");
    expect(text).toContain("Requests per UTC hour:");
  });
});
