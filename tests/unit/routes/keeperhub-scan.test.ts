import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Mock scan infrastructure
vi.mock("../../../src/agent-readiness/scanner/orchestrator.js", () => ({
  scanDomain: vi.fn().mockResolvedValue({ url: "https://example.com", fetchResults: {} }),
}));

vi.mock("../../../src/agent-readiness/rule-engine/rule-engine.js", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [
        { status: "VERIFIED", category: "a", rule_name: "r1" },
        { status: "VERIFIED", category: "a", rule_name: "r2" },
      ],
    }),
  },
}));

vi.mock("../../../src/agent-readiness/report-formatter.js", () => ({
  formatScanReport: vi.fn().mockReturnValue({
    url: "https://example.com",
    score: 85,
    grade: "B",
    total_rules: 145,
    verified: 140,
    missing: 5,
    gap: 5,
    not_applicable: 0,
    skipped: 0,
  }),
}));

vi.mock("../../../src/agent-readiness/scanner/ssrf/ip-guard.js", () => ({
  assertSafeTarget: vi.fn(),
}));

// Mock keeperhub lib
const mockExecuteWorkflow = vi.fn();
const mockPollExecution = vi.fn();
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  listWorkflows: vi.fn().mockResolvedValue([]),
  executeWorkflow: mockExecuteWorkflow,
  pollExecution: mockPollExecution,
};

vi.mock("../../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: vi.fn(() => mockClient),
  getKeeperHubToolContext: vi.fn(() => null),
  keeperhubDisabledResponse: vi.fn(() => ({ error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)" })),
  resetKeeperHubClient: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-trigger.js", () => ({
  triggerWorkflow: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-audit-store.js", () => ({
  auditStore: {
    add: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    size: vi.fn().mockReturnValue(0),
  },
}));

import { keeperhubApiRoutes } from "../../../src/server/routes/keeperhub-api";
import { scanDomain } from "../../../src/agent-readiness/scanner/orchestrator";
import { assertSafeTarget } from "../../../src/agent-readiness/scanner/ssrf/ip-guard";
import { getKeeperHubClient } from "../../../src/server/lib/keeperhub";
import { triggerWorkflow } from "../../../src/server/lib/keeperhub-trigger";
import { auditStore } from "../../../src/server/lib/keeperhub-audit-store";

describe("SLICE-126-10: POST /keeperhub/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.keeperhub = {
      enabled: true,
      apiKey: "kh_test",
      serverUrl: "https://app.keeperhub.com/mcp",
      triggerMode: "mcp",
      webhookUrls: {},
      workflowIds: { recordScan: "wf_scan_1" },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("503 disabled", async () => {
    mockConfig.keeperhub = undefined;
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(503);
  });

  it("400 missing url", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("url");
  });

  it("400 invalid url", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ht tp://bad url" }),
    });
    expect(res.status).toBe(400);
  });

  it("403 private url (assertSafeTarget throws)", async () => {
    vi.mocked(assertSafeTarget).mockImplementationOnce(() => {
      throw new Error("private IP");
    });
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://192.168.1.1" }),
    });
    expect(res.status).toBe(403);
  });

  it("dry-run default: 200, mode dry-run, functionArgs = [url, 85, 140, 145] exact order, NO client calls", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("dry-run");
    expect(body.scan.score).toBe(85);
    expect(body.scan.rulesPassed).toBe(140);
    expect(body.scan.rulesTotal).toBe(145);
    expect(body.wouldExecute.functionArgs).toEqual(["https://example.com", 85, 140, 145]);
    expect(body.wouldExecute.workflowId).toBe("wf_scan_1");
    expect(getKeeperHubClient).not.toHaveBeenCalled();
  });

  it("no workflowId + confirm → 502 with env var name in message", async () => {
    mockConfig.keeperhub = {
      ...mockConfig.keeperhub as object,
      workflowIds: {},
    };
    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", confirm: true }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("KEEPERHUB_WORKFLOW_RECORD_SCAN");
  });

  it("confirm happy: trigger → poll success → 200 executed, txHashes present, audit store contains event", async () => {
    vi.mocked(triggerWorkflow).mockResolvedValue({ executionId: "exec_1", via: "mcp" });
    mockPollExecution.mockResolvedValue({ status: "success", txHashes: ["0xabc", "0xdef"] });

    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", confirm: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("executed");
    expect(body.via).toBe("mcp");
    expect(body.executionId).toBe("exec_1");
    expect(body.txHashes).toEqual(["0xabc", "0xdef"]);
    expect(auditStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "agentbadge-record-scan",
        siteUrl: "https://example.com",
        status: "recorded",
        executionId: "exec_1",
      }),
    );
  });

  it("confirm poll-fails: pollExecution throws → 200 {mode: 'failed'} + store event status 'failed'", async () => {
    vi.mocked(triggerWorkflow).mockResolvedValue({ executionId: "exec_2", via: "mcp" });
    mockPollExecution.mockRejectedValue(new Error("execution error: terminal"));

    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", confirm: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("failed");
    expect(body.executionId).toBe("exec_2");
    expect(body.error).toContain("terminal");
    expect(auditStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        executionId: "exec_2",
      }),
    );
  });

  it("trigger throws → 502", async () => {
    vi.mocked(triggerWorkflow).mockRejectedValue(new Error("connection refused"));

    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", confirm: true }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("connection refused");
    expect(body.hint).toContain("KEEPERHUB_API_KEY");
  });

  it("scan internal error → 500", async () => {
    vi.mocked(scanDomain).mockRejectedValueOnce(new Error("network timeout"));

    const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Scan failed");
  });
});
