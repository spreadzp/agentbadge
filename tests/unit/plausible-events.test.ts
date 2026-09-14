/**
 * SLICE-130-12: Plausible custom events route integration tests.
 * Verifies that scan/badge routes emit Plausible events alongside GA4 events.
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
const trackPlausibleMock = vi.fn();

vi.mock("../../src/server/lib/google-analytics", () => ({
  isGa4Enabled: () => process.env.GA4_ENABLED === "true",
  trackPageView: vi.fn(),
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock("../../src/server/lib/plausible-events", () => ({
  isPlausibleEventsEnabled: () => process.env.PLAUSIBLE_ENABLED === "true" && !!process.env.PLAUSIBLE_DOMAIN,
  trackPlausibleEvent: (...args: unknown[]) => trackPlausibleMock(...args),
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

describe("SLICE-130-12: Plausible events in routes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    trackEventMock.mockClear();
    trackPlausibleMock.mockClear();
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123";
    process.env.GA4_API_SECRET = "test-secret";
    process.env.PLAUSIBLE_ENABLED = "true";
    process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET /scan emits plausible scan_started + scan_completed", async () => {
    await webmcpApiRoutes.request("/scan?url=https://example.com");
    const started = trackPlausibleMock.mock.calls.find((c) => c[0] === "scan_started");
    expect(started).toBeDefined();
    expect(started![1]).toMatchObject({ target_host: "example.com" });

    const completed = trackPlausibleMock.mock.calls.find((c) => c[0] === "scan_completed");
    expect(completed).toBeDefined();
    expect(completed![1]).toMatchObject({ score: 85, grade: "A" });
  });

  it("GET /badge emits plausible badge_generated", async () => {
    await webmcpApiRoutes.request("/badge?url=https://example.com");
    const badge = trackPlausibleMock.mock.calls.find((c) => c[0] === "badge_generated");
    expect(badge).toBeDefined();
    expect(badge![1]).toMatchObject({ grade: "A" });
  });

  it("disabled plausible → zero plausible calls", async () => {
    delete process.env.PLAUSIBLE_ENABLED;
    await webmcpApiRoutes.request("/scan?url=https://example.com");
    expect(trackPlausibleMock).not.toHaveBeenCalled();
  });
});
