import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdd } = vi.hoisted(() => ({
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

vi.mock("../../../src/agent-readiness/scanner/orchestrator.js", () => ({
  scanDomain: vi.fn(),
}));
vi.mock("../../../src/agent-readiness/rule-engine/rule-engine.js", () => ({
  RuleEngine: { run: vi.fn() },
}));
vi.mock("../../../src/agent-readiness/report-formatter.js", () => ({
  formatScanReport: vi.fn(),
}));
vi.mock("../../../src/agent-readiness/scanner/ssrf/ip-guard.js", () => ({
  assertSafeTarget: vi.fn(),
}));
vi.mock("../../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: vi.fn(),
  getKeeperHubToolContext: vi.fn(),
  keeperhubDisabledResponse: vi.fn(() => ({ error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)" })),
  resetKeeperHubClient: vi.fn(),
}));
vi.mock("../../../src/server/lib/keeperhub-trigger.js", () => ({
  triggerWorkflow: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-audit-store.js", () => ({
  auditStore: {
    add: mockAdd,
    list: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    size: vi.fn().mockReturnValue(0),
    listenerCount: vi.fn().mockReturnValue(0),
    once: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

import { keeperhubApiRoutes } from "../../../src/server/routes/keeperhub-api";

describe("SLICE-126-10: POST /keeperhub/audit/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.keeperhub = {
      enabled: true,
      apiKey: "kh_test",
      serverUrl: "https://app.keeperhub.com/mcp",
      triggerMode: "mcp",
      webhookUrls: {},
      workflowIds: {},
    };
  });

  it("503 disabled", async () => {
    mockConfig.keeperhub = undefined;
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "test", siteUrl: "https://example.com" }),
    });
    expect(res.status).toBe(503);
  });

  it("401 wrong secret when configured", async () => {
    mockConfig.keeperhub = { ...mockConfig.keeperhub as object, auditSecret: "super_secret" };
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong_secret" },
      body: JSON.stringify({ source: "test", siteUrl: "https://example.com" }),
    });
    expect(res.status).toBe(401);
  });

  it("401 missing secret when configured", async () => {
    mockConfig.keeperhub = { ...mockConfig.keeperhub as object, auditSecret: "super_secret" };
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "test", siteUrl: "https://example.com" }),
    });
    expect(res.status).toBe(401);
  });

  it("200 ok without secret when unset", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "test", siteUrl: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("body with string score '85' → coerced number in stored event", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "kh-callback", siteUrl: "https://example.com", score: "85", executionId: "exec_1" }),
    });
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 85,
        executionId: "exec_1",
      }),
    );
  });

  it("stored event source/siteUrl preserved; emitter fired", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "kh-record-scan", siteUrl: "https://my.site.com", score: 90 }),
    });
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "kh-record-scan",
        siteUrl: "https://my.site.com",
        score: 90,
        status: "recorded",
      }),
    );
  });
});
