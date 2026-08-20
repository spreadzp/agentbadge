import { describe, it, expect } from "vitest";
import { formatHtmlOutput } from "../../../../src/agent-readiness/cli/formatters/html-output";
import type { RuleResult } from "../../../../src/agent-readiness/cli/output";

function makeResults(): RuleResult[] {
  return [
    { rule_id: "AB-001", status: "pass", category: "discovery", name: "robots.txt found" },
    { rule_id: "AB-002", status: "fail", category: "discovery", name: "sitemap.xml not found", fix: { eligible: true, type: "add-file", note: "Add sitemap.xml at root" } },
    { rule_id: "AB-003", status: "skip", category: "documentation", name: "OpenAPI spec check skipped" },
    { rule_id: "AB-004", status: "pass", category: "payments", name: "x402 header present" },
  ];
}

describe("formatHtmlOutput", () => {
  it("produces valid standalone HTML document", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });

  it("renders score header with value", () => {
    const html = formatHtmlOutput(makeResults(), { score: 85 });
    expect(html).toContain("85");
    expect(html).toContain("/100");
    expect(html).toContain("Agent Readiness Score");
  });

  it("renders grade badge", () => {
    const html = formatHtmlOutput(makeResults(), { score: 92 });
    expect(html).toContain("grade-badge");
    expect(html).toContain(">A<");
  });

  it("renders grade B for score 80-89", () => {
    const html = formatHtmlOutput(makeResults(), { score: 82 });
    expect(html).toContain(">B<");
  });

  it("renders grade F for score < 60", () => {
    const html = formatHtmlOutput(makeResults(), { score: 45 });
    expect(html).toContain(">F<");
  });

  it("renders category sections", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).toContain("Discovery");
    expect(html).toContain("Documentation");
    expect(html).toContain("Payments");
  });

  it("renders pass/fail indicators", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).toContain("✓");
    expect(html).toContain("✗");
    expect(html).toContain("○");
  });

  it("renders category pass counts", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).toContain("1/2 passed");
    expect(html).toContain("0/1 passed");
  });

  it("includes fix suggestions when fixHints enabled", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75, fixHints: true });
    expect(html).toContain("Fix Suggestions");
    expect(html).toContain("Add sitemap.xml at root");
    expect(html).toContain("AB-002");
  });

  it("omits fix suggestions when fixHints disabled", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75, fixHints: false });
    expect(html).not.toContain("Fix Suggestions");
  });

  it("includes report URL when provided", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75, reportUrl: "https://agentbadge.xyz/report/123" });
    expect(html).toContain("https://agentbadge.xyz/report/123");
    expect(html).toContain("View full report");
  });

  it("omits report URL when not provided", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).not.toContain("View full report");
  });

  it("includes dark mode CSS via prefers-color-scheme", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("has no external dependencies (all CSS inline)", () => {
    const html = formatHtmlOutput(makeResults(), { score: 75 });
    expect(html).not.toMatch(/<link[^>]*stylesheet/i);
    expect(html).not.toMatch(/<script[^>]*src=/i);
  });

  it("escapes HTML in rule names", () => {
    const results: RuleResult[] = [
      { rule_id: "AB-001", status: "pass", category: "discovery", name: "<script>alert('xss')</script>" },
    ];
    const html = formatHtmlOutput(results, { score: 100 });
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles empty results gracefully", () => {
    const html = formatHtmlOutput([], { score: 0 });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("0");
  });
});
