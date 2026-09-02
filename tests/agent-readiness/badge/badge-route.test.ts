import { describe, it, expect, beforeEach } from "vitest";
import { createBadgeApp, type ReportStore } from "../../../src/agent-readiness/badge/badge-route";
import { BadgeCache } from "../../../src/agent-readiness/badge/badge-cache";
import type { AgentReadinessReport } from "../../../src/agent-readiness/report.schema";

function makeReport(score: number, scope: string = "test-api"): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.2.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: {
      agent_id: scope,
      agent_version: "1.0",
      endpoint_base_url: "https://test.com",
      timestamp: "2025-01-15T10:00:00.000Z",
    },
    scanned_at: new Date().toISOString(),
    previous_hash: null,
    source_state: [],
    score: { total: score, categories: {} },
    assertions: [],
    integrity: {
      content_hash: "a".repeat(64),
      signature: { algorithm: "ed25519", key_id: "k", value: "" },
    },
  } as unknown as AgentReadinessReport;
}

function createMockReportStore(reports: Map<string, AgentReadinessReport>): ReportStore {
  return {
    async get(scope: string) {
      return reports.get(scope) ?? null;
    },
  };
}

describe("SLICE-38-6: Badge Route Handler", () => {
  let cache: BadgeCache;
  let reports: Map<string, AgentReadinessReport>;
  let app: ReturnType<typeof createBadgeApp>;

  beforeEach(() => {
    cache = new BadgeCache();
    reports = new Map();
    const store = createMockReportStore(reports);
    app = createBadgeApp({ cache, reportStore: store });
  });

  it("returns 404 for unknown scope", async () => {
    const res = await app.request("/badge/unknown.svg");
    expect(res.status).toBe(404);
  });

  it("returns SVG for known scope", async () => {
    reports.set("test-api", makeReport(85));
    const res = await app.request("/badge/test-api.svg");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("85/100");
  });

  it("sets Content-Type to image/svg+xml", async () => {
    reports.set("test-api", makeReport(85));
    const res = await app.request("/badge/test-api.svg");
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it("sets Cache-Control header", async () => {
    reports.set("test-api", makeReport(85));
    const res = await app.request("/badge/test-api.svg");
    const cacheControl = res.headers.get("Cache-Control");
    expect(cacheControl).toContain("max-age=3600");
  });

  it("sets X-AgentBadge-Stale header to false for fresh report", async () => {
    reports.set("test-api", makeReport(85));
    const res = await app.request("/badge/test-api.svg");
    expect(res.headers.get("X-AgentBadge-Stale")).toBe("false");
  });

  it("sets X-AgentBadge-Stale header to true for old report", async () => {
    const oldReport = makeReport(85);
    oldReport.scanned_at = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    reports.set("test-api", oldReport);
    const res = await app.request("/badge/test-api.svg");
    expect(res.headers.get("X-AgentBadge-Stale")).toBe("true");
  });

  it("serves from cache on second request", async () => {
    reports.set("test-api", makeReport(85));
    const res1 = await app.request("/badge/test-api.svg");
    const body1 = await res1.text();

    // Remove report from store — second request should come from cache
    reports.delete("test-api");
    const res2 = await app.request("/badge/test-api.svg");
    const body2 = await res2.text();

    expect(res2.status).toBe(200);
    expect(body2).toBe(body1);
  });

  it("returns green color for score 91", async () => {
    reports.set("test-api", makeReport(91));
    const res = await app.request("/badge/test-api.svg");
    const body = await res.text();
    expect(body).toContain("#4c1");
  });

  it("returns red color for score 50", async () => {
    reports.set("test-api", makeReport(50));
    const res = await app.request("/badge/test-api.svg");
    const body = await res.text();
    expect(body).toContain("#e05d44");
  });

  it("includes metadata in SVG", async () => {
    reports.set("my-api", makeReport(85, "my-api"));
    const res = await app.request("/badge/my-api.svg");
    const body = await res.text();
    expect(body).toContain("my-api");
    expect(body).toContain("ruleset v1.2.0");
  });

  it("returns 400 for missing scope param", async () => {
    const res = await app.request("/badge/.svg");
    expect(res.status).toBe(404);
  });
});
