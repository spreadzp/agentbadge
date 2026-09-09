import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTriggerWorkflow, mockGetKeeperHubClient, mockScanDomain, mockRuleEngineRun, mockFormatScanReport, mockAdd } =
  vi.hoisted(() => ({
    mockTriggerWorkflow: vi.fn(),
    mockGetKeeperHubClient: vi.fn(),
    mockScanDomain: vi.fn(),
    mockRuleEngineRun: vi.fn(),
    mockFormatScanReport: vi.fn(),
    mockAdd: vi.fn(),
  }));

const mockConfig: Record<string, unknown> = {
  chainMode: "hedera",
  keeperhub: undefined,
  base: undefined,
};

vi.mock("../../../src/config/env.js", () => ({
  getConfig: vi.fn(() => mockConfig),
  loadConfig: vi.fn(() => mockConfig),
  resetConfigCache: vi.fn(),
}));

vi.mock("../../../src/agent-readiness/scanner/orchestrator.js", () => ({ scanDomain: mockScanDomain }));
vi.mock("../../../src/agent-readiness/rule-engine/rule-engine.js", () => ({ RuleEngine: { run: mockRuleEngineRun } }));
vi.mock("../../../src/agent-readiness/report-formatter.js", () => ({ formatScanReport: mockFormatScanReport }));
vi.mock("../../../src/agent-readiness/scanner/ssrf/ip-guard.js", () => ({ assertSafeTarget: vi.fn() }));

vi.mock("../../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: mockGetKeeperHubClient,
  getKeeperHubToolContext: vi.fn(),
  keeperhubDisabledResponse: vi.fn(() => ({ error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)" })),
  resetKeeperHubClient: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-trigger.js", () => ({ triggerWorkflow: mockTriggerWorkflow }));

vi.mock("../../../src/server/lib/keeperhub-onchain.js", () => ({
  readLatestScoreFor: vi.fn(),
  readRecentRecords: vi.fn(),
  resetKeeperHubPublicClient: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-audit-store.js", () => ({
  auditStore: {
    add: mockAdd,
    list: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    size: vi.fn().mockReturnValue(0),
    listenerCount: vi.fn().mockReturnValue(0),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
  },
}));

import { keeperhubApiRoutes } from "../../../src/server/routes/keeperhub-api";

const mockClient = {
  pollExecution: vi.fn(),
  txHashes: vi.fn().mockReturnValue([]),
};

function setupScanMocks(score = 85, grade = "A", rulesPassed = 140, rulesTotal = 145) {
  mockScanDomain.mockResolvedValue({});
  mockRuleEngineRun.mockReturnValue({});
  mockFormatScanReport.mockReturnValue({ score, grade, verified: rulesPassed, total_rules: rulesTotal });
}

function setupTriggerMocks(txHashes: string[] = ["0xabc"]) {
  mockTriggerWorkflow.mockResolvedValue({ executionId: "ex_test", via: "mcp" });
  mockClient.pollExecution.mockResolvedValue({ status: "success", txHashes });
}

function enabledKeeperHubConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    apiKey: "kh_test",
    serverUrl: "https://app.keeperhub.com/mcp",
    triggerMode: "mcp",
    webhookUrls: {},
    workflowIds: { recordScan: "wf_test" },
    ...overrides,
  };
}

describe("SLICE-126-13: POST /keeperhub/scan/premium (x402-gated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.keeperhub = enabledKeeperHubConfig();
    mockConfig.base = undefined;
    setupScanMocks();
    setupTriggerMocks();
    mockGetKeeperHubClient.mockReturnValue(mockClient);
  });

  it("503 when KeeperHub disabled", async () => {
    mockConfig.keeperhub = undefined;
    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(503);
  });

  it("503 when x402 disabled — with freeAlternative pointer", async () => {
    mockConfig.keeperhub = enabledKeeperHubConfig({ x402: undefined });
    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("x402 premium disabled");
    expect(body.freeAlternative).toContain("/api/keeperhub/scan");
  });

  it("200 executed — premium route calls shared scan→trigger→poll logic", async () => {
    mockConfig.keeperhub = enabledKeeperHubConfig({
      x402: { enabled: true, facilitatorUrl: "https://x402.org/facilitator", payTo: "0x1234", price: "$0.01" },
    });
    setupTriggerMocks(["0xtx1"]);

    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("executed");
    expect(body.scan.score).toBe(85);
    expect(body.txHashes).toEqual(["0xtx1"]);
    expect(mockTriggerWorkflow).toHaveBeenCalledWith(
      mockClient,
      "wf_test",
      { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
      expect.any(Object),
    );
  });

  it("200 mode=failed — execution failure still returns 200 (same as free confirm)", async () => {
    mockConfig.keeperhub = enabledKeeperHubConfig({
      x402: { enabled: true, facilitatorUrl: "https://x402.org/facilitator", payTo: "0x1234", price: "$0.01" },
    });
    mockClient.pollExecution.mockRejectedValue(new Error("execution timeout"));

    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("failed");
    expect(body.error).toContain("timeout");
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", siteUrl: "https://example.com" }),
    );
  });

  it("502 when workflow not provisioned", async () => {
    mockConfig.keeperhub = enabledKeeperHubConfig({
      x402: { enabled: true, facilitatorUrl: "https://x402.org/facilitator", payTo: "0x1234", price: "$0.01" },
      workflowIds: {},
    });

    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(502);
  });

  it("400 on missing url", async () => {
    mockConfig.keeperhub = enabledKeeperHubConfig({
      x402: { enabled: true, facilitatorUrl: "https://x402.org/facilitator", payTo: "0x1234", price: "$0.01" },
    });

    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON", async () => {
    mockConfig.keeperhub = enabledKeeperHubConfig({
      x402: { enabled: true, facilitatorUrl: "https://x402.org/facilitator", payTo: "0x1234", price: "$0.01" },
    });

    const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });
});

describe("SLICE-126-13: Free paths unchanged (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.keeperhub = enabledKeeperHubConfig();
    mockConfig.base = undefined;
    setupScanMocks();
    setupTriggerMocks();
    mockGetKeeperHubClient.mockReturnValue(mockClient);
  });

  it("POST /scan without confirm → dry-run (no payment, no trigger)", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("dry-run");
    expect(mockTriggerWorkflow).not.toHaveBeenCalled();
  });

  it("POST /scan with confirm → executes WITHOUT x402 (free confirm remains)", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", confirm: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("executed");
    expect(mockTriggerWorkflow).toHaveBeenCalled();
  });
});
