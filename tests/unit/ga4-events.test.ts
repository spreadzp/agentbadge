/**
 * SLICE-130-11: GA4 custom events tests.
 *
 * Verifies that scan and badge routes emit trackEvent calls
 * (scan_started, scan_completed, badge_generated) when GA4 is enabled,
 * and zero calls when disabled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
process.env.HEDERA_OPERATOR_ID = "0.0.1001";
process.env.HEDERA_OPERATOR_KEY = "test-key";
process.env.AUDIT_TOPIC_ID = "0.0.1003";
process.env.DIRECTORY_TOPIC_ID = "0.0.1004";
process.env["x402_FACILITATOR_URL"] = "https://facilitator.example.com";
process.env["x402_FEE_PAYER"] = "0.0.1005";
process.env["x402_TREASURY"] = "0.0.1006";
process.env.IPFS_API_KEY = "test-ipfs-key";
process.env.IPFS_API_SECRET = "test-ipfs-secret";
delete process.env.KEEPERHUB_ENABLED;
delete process.env.ATTESTCOIN_ENABLED;

const trackEventMock = vi.fn();
vi.mock("../../src/server/lib/google-analytics", () => ({
  isGa4Enabled: () => process.env.GA4_ENABLED === "true",
  trackPageView: vi.fn(),
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockResolvedValue({ snapshots: {} }),
}));

vi.mock("../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [],
      rulesetVersion: "1.0.0",
      scannedAt: new Date().toISOString(),
      totalRules: 10,
      applicableRules: 10,
    }),
  },
}));

vi.mock("../../src/agent-readiness/report-formatter", () => ({
  formatScanReport: vi.fn().mockReturnValue({
    url: "https://example.com",
    score: 85,
    grade: "A",
    verified: 8,
    total_rules: 10,
    categories: [],
  }),
}));

vi.mock("../../src/agent-readiness/badge/svg-generator", () => ({
  generateBadgeSvg: vi.fn().mockReturnValue("<svg>badge</svg>"),
}));

vi.mock("Bun", { spy: true });

const { webmcpApiRoutes } = await import("../../src/server/routes/webmcp-api");

describe("SLICE-130-11: GA4 custom events", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    trackEventMock.mockClear();
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123";
    process.env.GA4_API_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET /scan emits scan_started then scan_completed", async () => {
    const res = await webmcpApiRoutes.request("/scan?url=https://example.com");
    expect(res.status).toBe(200);
    expect(trackEventMock).toHaveBeenCalledTimes(2);

    const startedCall = trackEventMock.mock.calls.find((c) => c[0] === "scan_started");
    expect(startedCall).toBeDefined();
    expect(startedCall![1]).toMatchObject({ target_host: "example.com" });

    const completedCall = trackEventMock.mock.calls.find((c) => c[0] === "scan_completed");
    expect(completedCall).toBeDefined();
    expect(completedCall![1]).toMatchObject({ score: 85, grade: "A" });
  });

  it("GET /badge emits badge_generated", async () => {
    const res = await webmcpApiRoutes.request("/badge?url=https://example.com");
    expect(res.status).toBe(200);
    expect(trackEventMock).toHaveBeenCalledTimes(1);

    const badgeCall = trackEventMock.mock.calls.find((c) => c[0] === "badge_generated");
    expect(badgeCall).toBeDefined();
    expect(badgeCall![1]).toMatchObject({ grade: "A" });
  });

  it("disabled GA4 → zero trackEvent calls on scan", async () => {
    delete process.env.GA4_ENABLED;
    await webmcpApiRoutes.request("/scan?url=https://example.com");
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("disabled GA4 → zero trackEvent calls on badge", async () => {
    delete process.env.GA4_ENABLED;
    await webmcpApiRoutes.request("/badge?url=https://example.com");
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("scan_started uses hostname only (no full URL in params)", async () => {
    await webmcpApiRoutes.request("/scan?url=https://example.com/path?secret=abc");
    const startedCall = trackEventMock.mock.calls.find((c) => c[0] === "scan_started");
    expect(startedCall![1].target_host).toBe("example.com");
    expect(JSON.stringify(startedCall![1])).not.toContain("secret");
  });
});
