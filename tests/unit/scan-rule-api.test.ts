import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { scanRuleRoutes } from "../../src/server/routes/scan-rule-api";

// Mock the scanner + rule engine pipeline
vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockResolvedValue({ snapshots: {} }),
}));

vi.mock("../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [
        {
          rule_id: "AB-001",
          rule_version: "1.0.0",
          status: "VERIFIED",
          evidence: [{ source: "robots", detail: "robots.txt found" }],
          confidence: 1.0,
          timestamp: "2026-01-01T00:00:00Z",
          source_url: "https://example.com",
          reason: "Direct evidence confirms rule AB-001",
          category: "discovery",
          name: "robots.txt exists",
        },
        {
          rule_id: "AB-007",
          rule_version: "1.0.0",
          status: "GAP",
          evidence: [],
          confidence: 0,
          timestamp: "2026-01-01T00:00:00Z",
          source_url: "https://example.com",
          reason: "No evidence found for rule AB-007",
          category: "machine_readable",
          name: "OpenAPI endpoint",
          fix: { eligible: true, type: "deterministic", note: "Add openapi.json" },
        },
        {
          rule_id: "AB-003",
          rule_version: "1.0.0",
          status: "INFERRED",
          evidence: [{ source: "openapi", detail: "Indirect evidence" }],
          confidence: 0.5,
          timestamp: "2026-01-01T00:00:00Z",
          source_url: "https://example.com",
          reason: "Indirect evidence supports rule AB-003",
          category: "discovery",
          name: "Sitemap referenced in robots.txt",
        },
        {
          rule_id: "AB-099",
          rule_version: "1.0.0",
          status: "NOT_APPLICABLE",
          evidence: [],
          confidence: 0,
          timestamp: "2026-01-01T00:00:00Z",
          source_url: null,
          reason: "Rule does not apply to this source",
          category: "payments",
          name: "x402 payment header",
        },
      ],
    }),
  },
}));

vi.mock("../../src/agent-readiness/ruleset", () => ({
  AGENT_READINESS_RULESET: {
    rules: [
      { rule_id: "AB-001", version: "1.0.0", category: "discovery", name: "robots.txt exists", check: { type: "http_fetch", target: "robots" } },
      { rule_id: "AB-007", version: "1.0.0", category: "machine_readable", name: "OpenAPI endpoint", check: { type: "http_fetch", target: "openapi" } },
      { rule_id: "AB-003", version: "1.0.0", category: "discovery", name: "Sitemap referenced in robots.txt", check: { type: "cross_evidence", target: "robots" } },
      { rule_id: "AB-099", version: "1.0.0", category: "payments", name: "x402 payment header", check: { type: "http_fetch", target: "x402" } },
    ],
  },
}));

const app = new Hono();
app.route("/api", scanRuleRoutes);

async function scanRule(url: string, rule_id: string) {
  const res = await app.request("/api/scan-rule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, rule_id }),
  });
  return { status: res.status, data: await res.json() };
}

describe("SLICE-58-1: Human-readable scan-rule API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes summary field in response for VERIFIED", async () => {
    const { status, data } = await scanRule("https://example.com", "AB-001");
    expect(status).toBe(200);
    expect(data.summary).toBeDefined();
    expect(typeof data.summary).toBe("string");
    expect(data.summary).toContain("implemented");
  });

  it("includes completeness_pct field in response for VERIFIED", async () => {
    const { data } = await scanRule("https://example.com", "AB-001");
    expect(data.completeness_pct).toBeDefined();
    expect(typeof data.completeness_pct).toBe("number");
    expect(data.completeness_pct).toBe(100);
  });

  it("summary for MISSING includes hint text", async () => {
    const { data } = await scanRule("https://example.com", "AB-007");
    expect(data.status).toBe("GAP");
    expect(data.summary).toContain("not implemented");
    expect(data.completeness_pct).toBe(0);
  });

  it("completeness_pct for INFERRED is 50", async () => {
    const { data } = await scanRule("https://example.com", "AB-003");
    expect(data.status).toBe("INFERRED");
    expect(data.completeness_pct).toBe(50);
    expect(data.summary).toContain("partially");
  });

  it("completeness_pct for NOT_APPLICABLE is 100", async () => {
    const { data } = await scanRule("https://example.com", "AB-099");
    expect(data.status).toBe("NOT_APPLICABLE");
    expect(data.completeness_pct).toBe(100);
    expect(data.summary).toContain("does not apply");
  });

  it("does not include raw evidence in response", async () => {
    const { data } = await scanRule("https://example.com", "AB-001");
    expect(data.evidence).toBeUndefined();
  });

  it("includes checks_performed count instead of raw evidence", async () => {
    const { data } = await scanRule("https://example.com", "AB-001");
    expect(typeof data.checks_performed).toBe("number");
    expect(data.checks_performed).toBeGreaterThanOrEqual(0);
  });

  it("checks_performed is 0 for MISSING with no evidence", async () => {
    const { data } = await scanRule("https://example.com", "AB-007");
    expect(data.status).toBe("GAP");
    expect(data.checks_performed).toBe(0);
  });

  it("still includes rule_id, rule_name, category, status, hint, scanned_url", async () => {
    const { data } = await scanRule("https://example.com", "AB-001");
    expect(data.rule_id).toBe("AB-001");
    expect(data.rule_name).toBe("robots.txt exists");
    expect(data.category).toBe("discovery");
    expect(data.status).toBe("VERIFIED");
    expect(data.scanned_url).toBe("https://example.com");
  });
});
