import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { DEFAULT_RESOURCES } from "../../src/agent-readiness/scanner/orchestrator";
import { generateImprovementGuide } from "../../src/agent-readiness/generators/improvement-guide";
import { generateRobotsTxt } from "../../src/agent-readiness/generators/robots-generator";
import { generateBadgeSvg } from "../../src/agent-readiness/generators/badge-generator";
import { formatMarkdownOutput } from "../../src/agent-readiness/cli/output";
import { parseArgs, type CommandFlag } from "../../src/agent-readiness/cli/router";

const SCAN_FLAGS: CommandFlag[] = [
  { name: "json-api", type: "boolean", description: "" },
  { name: "category", type: "string", description: "" },
  { name: "format", type: "string", description: "", default: "text" },
  { name: "threshold", type: "string", description: "" },
  { name: "fix-hints", type: "boolean", description: "" },
  { name: "compact", type: "boolean", description: "" },
  { name: "report-url", type: "string", description: "" },
  { name: "json", shortName: "j", type: "boolean", description: "" },
  { name: "ci", type: "boolean", description: "" },
  { name: "fix", type: "boolean", description: "" },
  { name: "no-cache", type: "boolean", description: "" },
  { name: "watch", shortName: "w", type: "boolean", description: "" },
];

describe("SLICE-48-28: CLI parity integration tests", () => {
  it("ruleset has at least 100 rules (parity with agentgrade-cli)", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(100);
  });

  it("all rule IDs are unique", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all rule IDs follow AB-NNN format", () => {
    for (const r of AGENT_READINESS_RULESET.rules) {
      expect(r.rule_id).toMatch(/^AB-\d{3}$/);
    }
  });

  it("DEFAULT_RESOURCES has at least 32 resources", () => {
    expect(DEFAULT_RESOURCES.length).toBeGreaterThanOrEqual(32);
  });

  it("all new fetcher resources are in DEFAULT_RESOURCES", () => {
    const resources = [...DEFAULT_RESOURCES];
    for (const r of ["mcp_probe", "homepage_meta", "infrastructure", "a2a", "identity", "bot_auth"]) {
      expect(resources).toContain(r);
    }
  });

  it("optional rules have counted_in_score: false", () => {
    const optional = AGENT_READINESS_RULESET.rules.filter((r) => r.counted_in_score === false);
    expect(optional.length).toBeGreaterThan(0);
    for (const r of optional) {
      expect(r.counted_in_score).toBe(false);
    }
  });

  it("categories include payments, identity, infrastructure, bot_auth", () => {
    const categories = new Set(AGENT_READINESS_RULESET.rules.map((r) => r.category));
    expect(categories.has("payments")).toBe(true);
    expect(categories.has("identity")).toBe(true);
    expect(categories.has("infrastructure")).toBe(true);
    expect(categories.has("bot_auth")).toBe(true);
  });

  it("CLI parses all new flags together", () => {
    const { flags } = parseArgs(
      ["scan", "https://example.com", "--json-api", "--category", "payments", "--format", "json", "--fix-hints", "--compact", "--threshold", "80", "--report-url", "https://app.agentbadge.xyz/r/123"],
      SCAN_FLAGS,
    );
    expect(flags["json-api"]).toBe(true);
    expect(flags["category"]).toBe("payments");
    expect(flags["format"]).toBe("json");
    expect(flags["fix-hints"]).toBe(true);
    expect(flags["compact"]).toBe(true);
    expect(flags["threshold"]).toBe("80");
    expect(flags["report-url"]).toBe("https://app.agentbadge.xyz/r/123");
  });

  it("improvement guide generates from mock scan results", () => {
    const guide = generateImprovementGuide({
      score: 45,
      checks: [
        { id: "AB-015", name: "Content negotiation", status: "fail", category: "content_negotiation", hint: "Add accepts()" },
        { id: "AB-039", name: "x402.json", status: "fail", category: "payments", hint: "Create x402.json" },
      ],
    });
    expect(guide).toContain("# Improvement Guide");
    expect(guide).toContain("AB-015");
    expect(guide).toContain("AB-039");
  });

  it("robots.txt generator produces 21+ bots", () => {
    const robots = generateRobotsTxt({ allowAll: true });
    const count = (robots.match(/User-agent:/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(21);
  });

  it("badge SVG generator produces valid SVG", () => {
    const svg = generateBadgeSvg({ score: 85, grade: "A", categories: [{ name: "discovery", score: 90 }] });
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("85");
  });

  it("markdown output format works with fix hints", () => {
    const md = formatMarkdownOutput(
      [
        { rule_id: "AB-001", status: "pass", category: "discovery", name: "robots.txt" },
        { rule_id: "AB-015", status: "fail", category: "content_negotiation", name: "Content negotiation", fix: { eligible: true, type: "assisted", note: "Add accepts()" } },
      ],
      { score: 75, fixHints: true, reportUrl: "https://app.agentbadge.xyz/r/123" },
    );
    expect(md).toContain("# Agent Readiness Report");
    expect(md).toContain("75");
    expect(md).toContain("AB-001");
    expect(md).toContain("AB-015");
    expect(md).toContain("Fix Suggestions");
    expect(md).toContain("https://app.agentbadge.xyz/r/123");
  });
});
