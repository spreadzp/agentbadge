import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestApp, setupMockEnv } from "./helpers";
import { makeMockKeeperHubClient, makeMockKeeperHubConfig } from "../helpers/mock-keeperhub-client";

vi.mock("@agentbadge/keeperhub", () => ({
  allKeeperhubTools: [
    { name: "keeperhub-record-scan", description: "Record scan", inputSchema: {}, createHandler: () => () => ({ ok: true }) },
    { name: "keeperhub-mint-trust-badge", description: "Mint badge", inputSchema: {}, createHandler: () => () => ({ ok: true }) },
    { name: "keeperhub-workflow-status", description: "Workflow status", inputSchema: {}, createHandler: () => () => ({ status: "success" }) },
    { name: "keeperhub-audit", description: "Audit trail", inputSchema: {}, createHandler: () => () => ({ events: [] }) },
  ],
  KeeperHubClient: vi.fn().mockImplementation(() => makeMockKeeperHubClient()),
}));

vi.mock("../../src/config/env.js", () => {
  let currentConfig: Record<string, unknown> = {
    chainMode: "hedera",
    keeperhub: undefined,
    base: undefined,
  };
  return {
    getConfig: vi.fn(() => currentConfig),
    loadConfig: vi.fn(() => currentConfig),
    resetConfigCache: vi.fn(() => { }),
    setTestConfig: vi.fn((cfg: Record<string, unknown>) => { currentConfig = cfg; }),
  };
});

const mockClient = makeMockKeeperHubClient();

vi.mock("../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: vi.fn(() => mockClient),
  getKeeperHubToolContext: vi.fn(() => ({
    client: mockClient,
    apiBaseUrl: "https://agentbadge.xyz",
    workflowIds: { recordScan: "wf_1", mintPassport: "wf_2", notify: "wf_3" },
  })),
  keeperhubDisabledResponse: vi.fn(() => ({
    error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)",
  })),
  resetKeeperHubClient: vi.fn(),
}));

vi.mock("../../src/server/lib/keeperhub-trigger.js", () => ({
  triggerWorkflow: vi.fn(async () => ({
    executionId: "exec-mock-001",
    via: "mcp" as const,
  })),
}));

vi.mock("../../src/server/lib/keeperhub-onchain.js", () => ({
  readLatestScoreFor: vi.fn(async () => ({ score: 85, siteUrl: "https://agentbadge.xyz" })),
  readRecentRecords: vi.fn(async () => []),
  resetKeeperHubPublicClient: vi.fn(),
}));

const auditEvents: Array<Record<string, unknown>> = [];
const listeners: Array<(e: Record<string, unknown>) => void> = [];

vi.mock("../../src/server/lib/keeperhub-audit-store.js", () => {
  const store = {
    add: vi.fn((e: Record<string, unknown>) => {
      auditEvents.push(e);
      listeners.forEach((fn) => fn(e));
    }),
    list: vi.fn((opts?: { limit?: number; siteUrl?: string }) => {
      let events = [...auditEvents].reverse();
      if (opts?.siteUrl) events = events.filter((e) => e.siteUrl === opts.siteUrl);
      return events.slice(0, opts?.limit ?? 50);
    }),
    clear: vi.fn(() => { auditEvents.length = 0; }),
    size: vi.fn(() => auditEvents.length),
    listenerCount: vi.fn(() => listeners.length),
    on: vi.fn((event: string, fn: (e: Record<string, unknown>) => void) => { listeners.push(fn); }),
    off: vi.fn((event: string, fn: (e: Record<string, unknown>) => void) => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    once: vi.fn(),
    emit: vi.fn(),
  };
  return { auditStore: store, AuditEvent: undefined };
});

vi.mock("../../src/agent-readiness/scanner/orchestrator.js", () => ({
  scanDomain: vi.fn(async () => ({
    url: "https://agentbadge.xyz",
    robots: { found: true },
    llmsTxt: { found: true },
    openApi: { found: true },
    jsonLd: { found: true },
    openGraph: { found: true },
  })),
}));

vi.mock("../../src/agent-readiness/rule-engine/rule-engine.js", () => ({
  RuleEngine: {
    run: vi.fn(() => ({
      url: "https://agentbadge.xyz",
      assertions: [],
      verified: 140,
      total_rules: 145,
    })),
  },
}));

vi.mock("../../src/agent-readiness/report-formatter.js", () => ({
  formatScanReport: vi.fn(() => ({
    url: "https://agentbadge.xyz",
    score: 85,
    grade: "B+",
    verified: 140,
    total_rules: 145,
  })),
}));

vi.mock("../../src/agent-readiness/scanner/ssrf/ip-guard.js", () => ({
  assertSafeTarget: vi.fn((hostname: string) => {
    if (hostname.includes("10.") || hostname.includes("192.168.") || hostname.includes("127.") || hostname.includes("172.")) {
      throw new Error("Private IP not allowed");
    }
  }),
}));

import { getConfig } from "../../src/config/env";
import { auditStore } from "../../src/server/lib/keeperhub-audit-store";
import { triggerWorkflow } from "../../src/server/lib/keeperhub-trigger";

const enabledConfig = {
  chainMode: "hedera",
  keeperhub: makeMockKeeperHubConfig(),
  base: { trustRegistry: "0xregistry_test", trustBadge: "0xbadge_test" },
};

const disabledConfig = {
  chainMode: "hedera",
  keeperhub: undefined,
  base: undefined,
};

function setConfig(cfg: Record<string, unknown>) {
  vi.mocked(getConfig).mockReturnValue(cfg);
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

function readSSEStream(response: Response, timeoutMs = 3000): Promise<Array<{ event: string; data: string }>> {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(frames);
    }, timeoutMs);

    const frames: Array<{ event: string; data: string }> = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let currentEvent = "";
        let currentData = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData = line.slice(5).trim();
          } else if (line === "" && (currentEvent || currentData)) {
            frames.push({ event: currentEvent, data: currentData });
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
    clearTimeout(timer);
    resolve(frames);
  });
}

describe("SLICE-126-18: Tier 1 — KeeperHub flow e2e (CI)", () => {
  let app: ReturnType<typeof makeTestApp>;

  beforeEach(() => {
    setupMockEnv();
    app = makeTestApp();
    auditEvents.length = 0;
    listeners.length = 0;
    vi.clearAllMocks();
    setConfig(enabledConfig);
  });

  afterEach(() => {
    setConfig(disabledConfig);
  });

  describe("Journey A — page → dry-run → confirm → audit → SSE", () => {
    it("dry-run returns scan preview without triggering workflow", async () => {
      setConfig(enabledConfig);
      const res = await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("dry-run");
      expect(body.scan.score).toBe(85);
      expect(body.wouldExecute.functionArgs).toEqual(["https://agentbadge.xyz", 85, 140, 145]);
      expect(triggerWorkflow).not.toHaveBeenCalled();
    });

    it("confirm=true triggers workflow, polls, stores audit event", async () => {
      setConfig(enabledConfig);
      const res = await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz", confirm: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("executed");
      expect(body.executionId).toBe("exec-mock-001");
      expect(body.txHashes).toEqual(["0xabc123"]);
      expect(auditStore.add).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "agentbadge-record-scan",
          siteUrl: "https://agentbadge.xyz",
          status: "recorded",
        }),
      );
    });

    it("audit trail returns stored events", async () => {
      setConfig(enabledConfig);
      await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz", confirm: true }),
      });
      const res = await app.request("/api/keeperhub/audit");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].siteUrl).toBe("https://agentbadge.xyz");
      expect(body.onchain.source).toBe("0xregistry_test");
    });

    it("SSE stream sends snapshot then live audit event", async () => {
      setConfig(enabledConfig);
      const sseRes = await app.request("/api/keeperhub/audit/stream", {
        headers: { Accept: "text/event-stream" },
      });
      expect(sseRes.status).toBe(200);

      const readPromise = readSSEStream(sseRes, 2000);
      await new Promise((r) => setTimeout(r, 200));

      await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz", confirm: true }),
      });

      const frames = await readPromise;
      const snapshotFrame = frames.find((f) => f.event === "snapshot");
      expect(snapshotFrame).toBeDefined();
      const auditFrame = frames.find((f) => f.event === "audit");
      expect(auditFrame).toBeDefined();
      const auditData = JSON.parse(auditFrame!.data);
      expect(auditData.siteUrl).toBe("https://agentbadge.xyz");
    });

    it("no audit store leak between tests — count back to baseline", async () => {
      setConfig(enabledConfig);
      expect(auditEvents.length).toBe(0);
    });
  });

  describe("Journey B — failure mapping", () => {
    it("disabled env: scan/audit/stream → 503", async () => {
      setConfig(disabledConfig);
      const scanRes = await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz" }),
      });
      expect(scanRes.status).toBe(503);

      const auditRes = await app.request("/api/keeperhub/audit");
      expect(auditRes.status).toBe(503);

      const streamRes = await app.request("/api/keeperhub/audit/stream", {
        headers: { Accept: "text/event-stream" },
      });
      expect(streamRes.status).toBe(503);
    });

    it("confirm=true + poll fails → mode: failed + audit store has failed event", async () => {
      setConfig(enabledConfig);
      mockClient.pollExecution.mockRejectedValueOnce(new Error("execution timed out"));
      const res = await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz", confirm: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("failed");
      expect(body.error).toContain("timed out");
      expect(auditStore.add).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("SSRF guard: private IP url → 403", async () => {
      setConfig(enabledConfig);
      const res = await app.request("/api/keeperhub/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "http://192.168.1.1" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("Private URLs");
    });

    it("webhook receiver: valid secret roundtrip", async () => {
      setConfig({ ...enabledConfig, keeperhub: { ...enabledConfig.keeperhub, auditSecret: "wh_secret_123" } });
      const res = await app.request("/api/keeperhub/audit/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wh_secret_123" },
        body: JSON.stringify({ source: "keeperhub-callback", siteUrl: "https://example.com", score: 90 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("webhook receiver: wrong secret → 401", async () => {
      setConfig({ ...enabledConfig, keeperhub: { ...enabledConfig.keeperhub, auditSecret: "wh_secret_123" } });
      const res = await app.request("/api/keeperhub/audit/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong_secret" },
        body: JSON.stringify({ source: "test", siteUrl: "https://example.com" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Journey C — premium tier (x402 wiring)", () => {
    it("x402 disabled → 503 with freeAlternative", async () => {
      setConfig(enabledConfig);
      const res = await app.request("/api/keeperhub/scan/premium", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz" }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain("x402 premium disabled");
      expect(body.freeAlternative).toContain("/api/keeperhub/scan");
    });

    it("x402 enabled: premium route processes scan (middleware wiring proof — no 503 x402-disabled)", async () => {
      const x402Config = {
        ...enabledConfig,
        keeperhub: makeMockKeeperHubConfig({ x402Enabled: true }),
      };
      setConfig(x402Config);
      const res = await app.request("/api/keeperhub/scan/premium", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ url: "https://agentbadge.xyz" }),
      });
      expect(res.status).not.toBe(503);
      const body = await res.json();
      expect(body.error ?? "").not.toContain("x402 premium disabled");
    });
  });

  describe("Journey D — MCP tool surface (in-process)", () => {
    it("registerKeeperhubTools registers 4 keeperhub-* tools", async () => {
      vi.resetModules();
      const { registerKeeperhubTools } = await import("../../src/mcp/keeperhub-tools");
      const { listTools } = await import("@agentbadge/mcp");
      setConfig(enabledConfig);
      const count = registerKeeperhubTools();
      expect(count).toBe(4);
      const tools = listTools();
      const keeperhubTools = tools.filter((t: { name: string }) => t.name.startsWith("keeperhub-"));
      expect(keeperhubTools.length).toBe(4);
      const toolNames = keeperhubTools.map((t: { name: string }) => t.name).sort();
      expect(toolNames).toEqual([
        "keeperhub-audit",
        "keeperhub-mint-trust-badge",
        "keeperhub-record-scan",
        "keeperhub-workflow-status",
      ]);
    });

    it("keeperhub-workflow-status tool is registered with correct metadata", async () => {
      vi.resetModules();
      const { registerKeeperhubTools } = await import("../../src/mcp/keeperhub-tools");
      const { listTools } = await import("@agentbadge/mcp");
      setConfig(enabledConfig);
      registerKeeperhubTools();
      const tools = listTools();
      const statusTool = tools.find((t: { name: string }) => t.name === "keeperhub-workflow-status");
      expect(statusTool).toBeDefined();
      expect(statusTool!.description).toBeDefined();
      expect(statusTool!.inputSchema).toBeDefined();
    });
  });
});
