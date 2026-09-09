import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable mock config
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

// Mock keeperhub lib
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  listWorkflows: vi.fn().mockResolvedValue([{ id: "wf_1", name: "record-scan" }]),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: vi.fn(() => mockClient),
  getKeeperHubToolContext: vi.fn(() => null),
  keeperhubDisabledResponse: vi.fn(() => ({ error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)" })),
  resetKeeperHubClient: vi.fn(),
}));

import { keeperhubApiRoutes } from "../../../src/server/routes/keeperhub-api";
import { getKeeperHubClient } from "../../../src/server/lib/keeperhub";

function makeApp() {
  // Hono app for testing — routes are already a Hono instance
  return keeperhubApiRoutes;
}

describe("SLICE-126-9: KeeperHub API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.keeperhub = undefined;
    mockConfig.base = undefined;
  });

  describe("GET /keeperhub/status", () => {
    it("disabled → 503 with error message", async () => {
      const app = makeApp();
      const res = await app.request("/keeperhub/status");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain("not enabled");
    });

    it("enabled → 200 with config probe", async () => {
      mockConfig.keeperhub = {
        enabled: true,
        serverUrl: "https://app.keeperhub.com/mcp",
        workflowIds: { recordScan: "wf_1", mintPassport: null, notify: null },
      };
      mockConfig.base = { trustRegistry: "0xabc", trustBadge: "0xdef" };

      const app = makeApp();
      const res = await app.request("/keeperhub/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(true);
      expect(body.serverUrl).toBe("https://app.keeperhub.com/mcp");
      expect(body.workflows.recordScan).toBe("wf_1");
      expect(body.workflows.mintPassport).toBeNull();
      expect(body.trustContracts.registry).toBe("0xabc");
      expect(body.trustContracts.badge).toBe("0xdef");
    });

    it("enabled with no workflow IDs → nulls", async () => {
      mockConfig.keeperhub = {
        enabled: true,
        serverUrl: "https://app.keeperhub.com/mcp",
        workflowIds: {},
      };
      mockConfig.base = {};

      const app = makeApp();
      const res = await app.request("/keeperhub/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows.recordScan).toBeNull();
      expect(body.workflows.mintPassport).toBeNull();
      expect(body.workflows.notify).toBeNull();
      expect(body.trustContracts.registry).toBeNull();
      expect(body.trustContracts.badge).toBeNull();
    });
  });

  describe("POST /keeperhub/ping", () => {
    it("disabled → 503", async () => {
      const app = makeApp();
      const res = await app.request("/keeperhub/ping", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain("not enabled");
    });

    it("enabled, client resolves → 200 ok", async () => {
      mockConfig.keeperhub = { enabled: true, serverUrl: "https://app.keeperhub.com/mcp", workflowIds: {} };
      mockClient.listWorkflows.mockResolvedValue([{ id: "wf_1", name: "record-scan" }]);

      const app = makeApp();
      const res = await app.request("/keeperhub/ping", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.workflows).toBeDefined();
      expect(getKeeperHubClient).toHaveBeenCalled();
    });

    it("enabled, client rejects → 200 with fail payload (never 500)", async () => {
      mockConfig.keeperhub = { enabled: true, serverUrl: "https://app.keeperhub.com/mcp", workflowIds: {} };
      mockClient.listWorkflows.mockRejectedValue(new Error("connection refused"));

      const app = makeApp();
      const res = await app.request("/keeperhub/ping", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain("connection refused");
    });
  });
});
