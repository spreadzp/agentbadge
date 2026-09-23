import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock scanner + rule engine (same shape as tests/unit/total-scan-api.test.ts)
vi.mock("../../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockImplementation(
    async (
      _url: string,
      opts?: { onProgress?: (resource: string, completed: number, total: number) => void },
    ) => {
      const resources = ["robots", "sitemap", "openapi"];
      resources.forEach((r, i) => opts?.onProgress?.(r, i + 1, resources.length));
      return { snapshots: {} };
    },
  ),
}));

vi.mock("../../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [
        { rule_id: "AB-001", status: "VERIFIED", evidence: [{ source: "robots" }], category: "discovery", name: "robots.txt" },
        { rule_id: "AB-002", status: "GAP", evidence: [], category: "discovery", name: "sitemap" },
      ],
      totalRules: 2,
    }),
  },
}));

vi.mock("../../../src/agent-readiness/ruleset", () => ({
  AGENT_READINESS_RULESET: {
    name: "agent-readiness",
    version: "2.2.0",
    rules: [],
    scoring: {
      pillars: {
        weights: { discovery: 20, understandability: 25, executability: 30, verifiability: 25 },
        scoringModel: "v2-pillars" as const,
      },
    },
  },
}));

import { resetConfigCache } from "../../../src/config/env";
import { resetDatabaseForTests } from "../../../src/server/lib/database";
import {
  cacheScanData,
  clearScanCache,
  getLatestScanForDomain,
} from "../../../src/server/profile/profile-store";
import { profileRoutes } from "../../../src/server/routes/profile";
import { totalScanRoutes } from "../../../src/server/routes/total-scan-api";
import {
  latestScanResult,
  recordScanResult,
} from "../../../src/server/services/scan-store";
import { setupMockEnv } from "../../e2e/helpers";
import { makeFixtureAssertions, makeFixtureScanReport } from "../profile/fixtures/scan-report-fixture";

/**
 * SLICE-145-2: scan-store service — write-behind ScanResult persistence +
 * profile-store delegation. DATABASE_ENABLED unset → in-memory fallback
 * (zero behavior change contract from EPIC-143).
 */
describe("scan-store (DATABASE_ENABLED unset → in-memory)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("recordScanResult + latestScanResult round-trip, domain normalized", async () => {
    recordScanResult({
      domain: "https://www.Example.com/path",
      url: "https://www.example.com/path",
      score: 42,
      report: { scanReport: { url: "https://www.example.com/path" } },
      rulesetVersion: "2.2.0",
    });

    const row = await latestScanResult("example.com");
    expect(row).not.toBeNull();
    expect(row?.domain).toBe("example.com");
    expect(row?.score).toBe(42);
    expect(row?.rulesetVersion).toBe("2.2.0");
  });

  it("latestScanResult returns newest row per domain", async () => {
    recordScanResult({ domain: "a.dev", url: "https://a.dev", score: 1, report: { n: 1 } });
    recordScanResult({ domain: "a.dev", url: "https://a.dev", score: 2, report: { n: 2 } });
    recordScanResult({ domain: "b.dev", url: "https://b.dev", score: 9, report: { n: 9 } });

    const latest = await latestScanResult("a.dev");
    expect(latest?.score).toBe(2);
    expect(await latestScanResult("absent.dev")).toBeNull();
  });

  it("recordScanResult is fire-and-forget — returns void, never throws", () => {
    expect(() =>
      recordScanResult({ domain: "x.dev", url: "https://x.dev", report: {} }),
    ).not.toThrow();
  });

  it("profile-store delegates: cacheScanData → getLatestScanForDomain", async () => {
    cacheScanData("API.Example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "DELEGATE-1",
    });

    const data = await getLatestScanForDomain("api.example.com");
    expect(data).not.toBeNull();
    expect(data?.reportId).toBe("DELEGATE-1");
    expect(data?.scanReport.url).toBeTruthy();
    expect(data?.assertions.length).toBeGreaterThan(0);
  });

  it("clearScanCache drops stored scans", async () => {
    cacheScanData("gone.dev", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    clearScanCache();
    expect(await getLatestScanForDomain("gone.dev")).toBeNull();
  });
});

describe("POST /total-scan persists ScanResult (SLICE-145-2)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    resetDatabaseForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  const app = () => {
    const a = new Hono();
    a.route("/api", totalScanRoutes);
    a.route("/", profileRoutes);
    return a;
  };

  it("scan → latestScanResult row → profile endpoint serves data", async () => {
    const res = await app().request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: done");

    // write-behind landed in the store (in-memory fallback)
    const row = await latestScanResult("example.com");
    expect(row).not.toBeNull();
    expect(row?.domain).toBe("example.com");
    expect(row?.url).toBe("https://example.com");
    expect(row?.rulesetVersion).toBe("2.2.0");

    // profile endpoint reads it back through profile-store
    const profile = await app().request("/api/profile/example.com");
    expect(profile.status).toBe(200);
    const body = await profile.json();
    expect(body.service.domain).toBe("example.com");
  });
});

describe("PG mode (opt-in: DATABASE_URL_LIVE → local docker PG)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("record → simulated restart → latestScanResult still returns row", async () => {
    if (!process.env.DATABASE_URL_LIVE) return; // opt-in: set to local docker PG
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = process.env.DATABASE_URL_LIVE;
    resetConfigCache();
    resetDatabaseForTests();

    const tag = `pg-${Date.now()}.dev`;
    recordScanResult({
      domain: tag,
      url: `https://${tag}`,
      score: 77,
      report: { scanReport: { url: `https://${tag}` } },
      rulesetVersion: "2.2.0",
    });

    // Wait for the fire-and-forget write to land
    const { getDatabase } = await import("../../../src/server/lib/database");
    for (let i = 0; i < 50; i++) {
      const row = await getDatabase().scanResults.latestByDomain(tag);
      if (row) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Simulate server restart: drop the singleton, rebuild from PG
    resetDatabaseForTests();
    const row = await latestScanResult(tag);
    expect(row).not.toBeNull();
    expect(row?.domain).toBe(tag);
    expect(row?.score).toBe(77);
  });
});
