import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReadLatestScoreFor, mockReadRecentRecords, mockList, mockAdd } = vi.hoisted(() => ({
  mockReadLatestScoreFor: vi.fn(),
  mockReadRecentRecords: vi.fn(),
  mockList: vi.fn().mockReturnValue([]),
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

vi.mock("../../../src/agent-readiness/scanner/orchestrator.js", () => ({ scanDomain: vi.fn() }));
vi.mock("../../../src/agent-readiness/rule-engine/rule-engine.js", () => ({ RuleEngine: { run: vi.fn() } }));
vi.mock("../../../src/agent-readiness/report-formatter.js", () => ({ formatScanReport: vi.fn() }));
vi.mock("../../../src/agent-readiness/scanner/ssrf/ip-guard.js", () => ({ assertSafeTarget: vi.fn() }));
vi.mock("../../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: vi.fn(),
  getKeeperHubToolContext: vi.fn(),
  keeperhubDisabledResponse: vi.fn(() => ({ error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)" })),
  resetKeeperHubClient: vi.fn(),
}));
vi.mock("../../../src/server/lib/keeperhub-trigger.js", () => ({ triggerWorkflow: vi.fn() }));

vi.mock("../../../src/server/lib/keeperhub-onchain.js", () => ({
  readLatestScoreFor: mockReadLatestScoreFor,
  readRecentRecords: mockReadRecentRecords,
  resetKeeperHubPublicClient: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-audit-store.js", () => ({
  auditStore: {
    add: mockAdd,
    list: mockList,
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

describe("SLICE-126-11: GET /keeperhub/audit", () => {
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
    mockConfig.base = undefined;
  });

  it("503 disabled", async () => {
    mockConfig.keeperhub = undefined;
    const res = await keeperhubApiRoutes.request("/keeperhub/audit");
    expect(res.status).toBe(503);
  });

  it("200: events from store, newest first, limit respected", async () => {
    const events = [
      { id: "e2", source: "scan", siteUrl: "https://b.com", status: "recorded", receivedAt: "2026-01-02" },
      { id: "e1", source: "scan", siteUrl: "https://a.com", status: "recorded", receivedAt: "2026-01-01" },
    ];
    mockList.mockReturnValue(events);

    const res = await keeperhubApiRoutes.request("/keeperhub/audit?limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].id).toBe("e2");
    expect(mockList).toHaveBeenCalledWith({ limit: 10, siteUrl: undefined });
  });

  it("siteUrl filter passed to store.list", async () => {
    mockList.mockReturnValue([]);
    const res = await keeperhubApiRoutes.request("/keeperhub/audit?siteUrl=https://example.com");
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({ limit: 50, siteUrl: "https://example.com" });
  });

  it("siteUrl + registry configured + onchain mock → onchain.latest populated", async () => {
    mockConfig.base = { rpcUrl: "https://sepolia.base.org", chainId: 84532, trustRegistry: "0xreg123" };
    mockReadLatestScoreFor.mockResolvedValue({ score: 85, recordedAt: 1700000000, valid: true });
    mockList.mockReturnValue([]);

    const res = await keeperhubApiRoutes.request("/keeperhub/audit?siteUrl=https://example.com");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onchain.latest).toEqual({ score: 85, recordedAt: 1700000000, valid: true });
    expect(body.onchain.source).toBe("0xreg123");
  });

  it("registry unset → onchain.source null, no read calls", async () => {
    mockList.mockReturnValue([]);
    const res = await keeperhubApiRoutes.request("/keeperhub/audit");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onchain.source).toBeNull();
    expect(mockReadRecentRecords).not.toHaveBeenCalled();
  });

  it("viem failure → onchain.recent null, still 200 (graceful)", async () => {
    mockConfig.base = { rpcUrl: "https://sepolia.base.org", chainId: 84532, trustRegistry: "0xreg123" };
    mockReadRecentRecords.mockRejectedValue(new Error("RPC down"));
    mockList.mockReturnValue([]);

    const res = await keeperhubApiRoutes.request("/keeperhub/audit");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onchain.recent).toBeUndefined();
  });

  it("txUrlTemplate present with Basescan URL", async () => {
    mockList.mockReturnValue([]);
    const res = await keeperhubApiRoutes.request("/keeperhub/audit");
    const body = await res.json();
    expect(body.explorer.name).toBe("Basescan");
    expect(body.explorer.txUrlTemplate).toBe("https://sepolia.basescan.org/tx/{hash}");
  });

  it("limit clamp: limit=999 → 100", async () => {
    mockList.mockReturnValue([]);
    const res = await keeperhubApiRoutes.request("/keeperhub/audit?limit=999");
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({ limit: 100, siteUrl: undefined });
  });

  it("limit clamp: limit=0 → 1", async () => {
    mockList.mockReturnValue([]);
    const res = await keeperhubApiRoutes.request("/keeperhub/audit?limit=0");
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({ limit: 1, siteUrl: undefined });
  });

  it("onchain=false query → skips onchain reads", async () => {
    mockConfig.base = { rpcUrl: "https://sepolia.base.org", chainId: 84532, trustRegistry: "0xreg123" };
    mockList.mockReturnValue([]);

    const res = await keeperhubApiRoutes.request("/keeperhub/audit?onchain=false");
    expect(res.status).toBe(200);
    expect(mockReadRecentRecords).not.toHaveBeenCalled();
  });
});
