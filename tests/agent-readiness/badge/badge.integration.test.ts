import { describe, it, expect, beforeEach } from "vitest";
import { createBadgeApp, type ReportStore } from "../../../src/agent-readiness/badge/badge-route";
import { BadgeCache } from "../../../src/agent-readiness/badge/badge-cache";
import { generateBadgeSvg } from "../../../src/agent-readiness/badge/svg-generator";
import { checkStaleness } from "../../../src/agent-readiness/badge/ttl-manager";
import type { AgentReadinessReport } from "../../../src/agent-readiness/report.schema";

function makeReport(score: number, scope: string = "test-api", scannedAt?: string): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.1.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: {
      agent_id: scope,
      agent_version: "1.0",
      endpoint_base_url: "https://test.com",
      timestamp: "2025-01-15T10:00:00.000Z",
    },
    scanned_at: scannedAt ?? new Date().toISOString(),
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

describe("SLICE-38-7: Badge Integration Tests — E2E Route + Cache", () => {
  let cache: BadgeCache;
  let reports: Map<string, AgentReadinessReport>;
  let app: ReturnType<typeof createBadgeApp>;

  beforeEach(() => {
    cache = new BadgeCache();
    reports = new Map();
    const store = createMockReportStore(reports);
    app = createBadgeApp({ cache, reportStore: store });
  });

  describe("E2E: known scope → 200 + SVG", () => {
    it("returns 200 with valid SVG body", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<svg");
      expect(body).toContain("</svg>");
    });

    it("returns 404 for unknown scope", async () => {
      const res = await app.request("/badge/unknown.svg");
      expect(res.status).toBe(404);
    });
  });

  describe("E2E: stale variant", () => {
    it("stale report shows ⚠ stale in SVG", async () => {
      const oldReport = makeReport(85, "test-api", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      reports.set("test-api", oldReport);
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).toContain("⚠ stale");
    });

    it("fresh report does NOT show ⚠ stale", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).not.toContain("⚠ stale");
    });

    it("stale report sets X-AgentBadge-Stale: true", async () => {
      const oldReport = makeReport(85, "test-api", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      reports.set("test-api", oldReport);
      const res = await app.request("/badge/test-api.svg");
      expect(res.headers.get("X-AgentBadge-Stale")).toBe("true");
    });

    it("fresh report sets X-AgentBadge-Stale: false", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      expect(res.headers.get("X-AgentBadge-Stale")).toBe("false");
    });
  });

  describe("E2E: cache behavior", () => {
    it("cache hit returns same SVG as first request", async () => {
      reports.set("test-api", makeReport(85));
      const res1 = await app.request("/badge/test-api.svg");
      const body1 = await res1.text();

      reports.delete("test-api");
      const res2 = await app.request("/badge/test-api.svg");
      const body2 = await res2.text();

      expect(body2).toBe(body1);
    });

    it("cache stores entry with reportId", async () => {
      reports.set("test-api", makeReport(85));
      await app.request("/badge/test-api.svg");
      expect(cache.has("test-api")).toBe(true);
      const entry = cache.get("test-api");
      expect(entry?.reportId).toBe("01HTEST0000000000000000001");
    });

    it("invalidate forces re-fetch", async () => {
      reports.set("test-api", makeReport(85));
      const res1 = await app.request("/badge/test-api.svg");
      const body1 = await res1.text();

      cache.invalidate("test-api");
      reports.set("test-api", makeReport(90));
      const res2 = await app.request("/badge/test-api.svg");
      const body2 = await res2.text();

      expect(body2).not.toBe(body1);
      expect(body2).toContain("90/100");
    });
  });

  describe("E2E: headers", () => {
    it("Cache-Control header present", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    });

    it("Content-Type is image/svg+xml", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    });
  });

  describe("E2E: SVG content", () => {
    it("contains clickable link to report", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).toContain("<a href");
      expect(body).toContain("agentbadge.dev/r/");
    });

    it("contains metadata: scope + ruleset + date", async () => {
      reports.set("my-api", makeReport(85, "my-api"));
      const res = await app.request("/badge/my-api.svg");
      const body = await res.text();
      expect(body).toContain("my-api");
      expect(body).toContain("ruleset v1.2.0");
    });

    it("green for score >= 90", async () => {
      reports.set("test-api", makeReport(95));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).toContain("#4c1");
    });

    it("yellow for 70 <= score < 90", async () => {
      reports.set("test-api", makeReport(75));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).toContain("#dfb317");
    });

    it("red for score < 70", async () => {
      reports.set("test-api", makeReport(50));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).toContain("#e05d44");
    });
  });

  describe("E2E: determinism", () => {
    it("same report → same SVG bytes (via route)", async () => {
      const fixedDate = "2025-01-15T10:00:00.000Z";
      reports.set("test-api", makeReport(85, "test-api", fixedDate));
      const res1 = await app.request("/badge/test-api.svg");
      const body1 = await res1.text();

      cache.invalidate("test-api");
      const res2 = await app.request("/badge/test-api.svg");
      const body2 = await res2.text();

      expect(body2).toBe(body1);
    });

    it("generateBadgeSvg is deterministic for same input", () => {
      const input = {
        scope: "test-api",
        score: 85,
        rulesetVersion: "1.2.0",
        scannedAt: "2025-01-15T10:00:00.000Z",
        reportUrl: "https://agentbadge.dev/r/test",
        stale: false,
      };
      expect(generateBadgeSvg(input)).toBe(generateBadgeSvg(input));
    });
  });

  describe("E2E: no external dependencies", () => {
    it("SVG does not reference external stylesheets", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).not.toContain("@import");
      expect(body).not.toContain("<link");
      expect(body).not.toContain("<style");
      expect(body).not.toMatch(/href="https?:\/\/[^"]*\.css/);
    });

    it("SVG uses inline styles only", async () => {
      reports.set("test-api", makeReport(85));
      const res = await app.request("/badge/test-api.svg");
      const body = await res.text();
      expect(body).toContain("fill=");
      expect(body).toContain("font-family=\"monospace\"");
    });
  });

  describe("E2E: TTL manager integration", () => {
    it("checkStaleness returns stale=true for old report", () => {
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = checkStaleness(oldDate, 7);
      expect(result.stale).toBe(true);
    });

    it("checkStaleness returns stale=false for fresh report", () => {
      const result = checkStaleness(new Date().toISOString(), 7);
      expect(result.stale).toBe(false);
    });
  });
});
