/**
 * SLICE-201-15: /agent-readiness — dogfooding showcase page.
 * Route factory takes an injectable scanFn (real impl = local scanner
 * orchestrator, no HTTP call); tests use a mock ScanReport.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createShowcaseRoutes } from "../src/server/routes/agent-readiness-showcase";
import type { ScanReport } from "../src/agent-readiness/report-formatter";

const MOCK_REPORT: ScanReport = {
  url: "https://agentbadge.xyz",
  score: 87,
  grade: "B",
  total_rules: 15,
  verified: 12,
  missing: 2,
  gap: 2,
  not_applicable: 1,
  skipped: 0,
  categories: [
    {
      category: "discoverability",
      name: "Discoverability",
      icon: "🔎",
      total: 5,
      verified: 5,
      missing: 0,
      completeness_pct: 100,
    },
  ],
  top_missing: [
    {
      rule_id: "AB-999",
      title: "Some missing check",
      category: "x",
      hint: "h",
      effort_hint: "e",
      estimated_cost: "c",
    },
  ],
  summary: "Your site scored 87/100.",
  pillars: [],
  floorTriggered: false,
  floorReason: null,
  assertions: [
    {
      rule_id: "AB-001",
      rule_version: "1",
      status: "VERIFIED",
      confidence: 1,
      timestamp: "t",
      source_url: null,
      reason: "found",
      category: "discoverability",
      name: "Robots.txt File",
      claim: "c",
      verified_at: "t",
      review_level: null,
      source_class: null,
      source_label: null,
      evidence: [],
      severity: "high",
    },
    {
      rule_id: "AB-999",
      rule_version: "1",
      status: "GAP",
      confidence: 1,
      timestamp: "t",
      source_url: null,
      reason: "missing",
      category: "x",
      name: "Some missing check",
      claim: "c",
      verified_at: "t",
      review_level: null,
      source_class: null,
      source_label: null,
      evidence: [],
      severity: "low",
    },
  ],
  gaps: [],
  gap_summary: {
    total: 0,
    by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 },
  },
};

function makeApp(scanFn: () => Promise<ScanReport>) {
  const app = new Hono();
  app.route("/", createShowcaseRoutes({ scanFn }));
  return app;
}

describe("GET /agent-readiness (201-15)", () => {
  it("returns 200 with explanation + scan sections", async () => {
    const app = makeApp(async () => MOCK_REPORT);
    const res = await app.request("/agent-readiness");
    expect(res.status).toBe(200);
    const html = await res.text();
    // explanation: three representations with live example
    expect(html).toContain("/blog/arc-c29-task-board.json");
    expect(html).toContain("FOR AI AGENTS");
    // scan section: rules + verdicts visible
    expect(html).toContain("87");
    expect(html).toContain("VERIFIED");
    expect(html).toContain("Robots.txt File");
    // honest wording — no marketing claims
    expect(html).not.toMatch(/AI-optimized/i);
  });

  it("serves cached result on repeat request (ttl ≥ 1h)", async () => {
    let calls = 0;
    const app = makeApp(async () => {
      calls++;
      return MOCK_REPORT;
    });
    await app.request("/agent-readiness");
    await app.request("/agent-readiness");
    expect(calls).toBe(1);
    // refresh forces rescan
    await app.request("/agent-readiness?refresh=1");
    expect(calls).toBe(2);
  });

  it("still renders when scanner fails", async () => {
    const app = makeApp(async () => {
      throw new Error("network down");
    });
    const res = await app.request("/agent-readiness");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/unavailable|unavailable|failed/i);
  });
});

describe("GET /agent-readiness.json (201-15)", () => {
  it("returns machine-readable descriptor", async () => {
    const app = makeApp(async () => MOCK_REPORT);
    const res = await app.request("/agent-readiness.json");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.type).toBe("agent-readiness-showcase");
    expect(json.what).toBeTruthy();
    expect(json.scanned).toBeTruthy();
    const scan = json.scan as { status: string; score?: number };
    expect(["ok", "unavailable"]).toContain(scan.status);
    expect(scan.score).toBe(87);
  });

  it("page links rel=alternate to the JSON variant", async () => {
    const app = makeApp(async () => MOCK_REPORT);
    const res = await app.request("/agent-readiness");
    const html = await res.text();
    expect(html).toContain('href="/agent-readiness.json"');
    expect(html).toContain('rel="alternate"');
  });
});
