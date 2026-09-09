import { describe, it, expect, vi, beforeEach } from "vitest";

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
  keeperhubDisabledResponse: vi.fn(() => ({
    error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)",
  })),
  resetKeeperHubClient: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-trigger.js", () => ({ triggerWorkflow: vi.fn() }));

vi.mock("../../../src/server/lib/keeperhub-onchain.js", () => ({
  readLatestScoreFor: vi.fn(),
  readRecentRecords: vi.fn(),
  resetKeeperHubPublicClient: vi.fn(),
}));

vi.mock("../../../src/server/lib/keeperhub-audit-store.js", () => ({
  auditStore: {
    add: vi.fn(),
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

describe("SLICE-126-17: Feature-gate contract — zero behavior change when disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.keeperhub = undefined;
    mockConfig.base = undefined;
  });

  describe("All KeeperHub routes return 503 when disabled", () => {
    it("GET /keeperhub/status → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/status");
      expect(res.status).toBe(503);
    });

    it("POST /keeperhub/ping → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/ping", { method: "POST" });
      expect(res.status).toBe(503);
    });

    it("POST /keeperhub/scan → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      expect(res.status).toBe(503);
    });

    it("POST /keeperhub/scan/premium → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      expect(res.status).toBe(503);
    });

    it("POST /keeperhub/audit/webhook → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/audit/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "test" }),
      });
      expect(res.status).toBe(503);
    });

    it("GET /keeperhub/audit → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/audit");
      expect(res.status).toBe(503);
    });

    it("GET /keeperhub/audit/stream → 503", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream");
      expect(res.status).toBe(503);
    });
  });

  describe("Disabled response body contains helpful message", () => {
    it("status route body has error message", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/status");
      const body = await res.json();
      expect(body.error).toContain("not enabled");
    });

    it("scan route body has error message", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      const body = await res.json();
      expect(body.error).toContain("not enabled");
    });

    it("premium route body has error message", async () => {
      const res = await keeperhubApiRoutes.request("/keeperhub/scan/premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      const body = await res.json();
      expect(body.error).toContain("not enabled");
    });
  });

  describe("No KeeperHub side effects when disabled", () => {
    it("audit store add is never called", async () => {
      const { auditStore } = await import("../../../src/server/lib/keeperhub-audit-store.js");
      await keeperhubApiRoutes.request("/keeperhub/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", confirm: true }),
      });
      expect(auditStore.add).not.toHaveBeenCalled();
    });

    it("triggerWorkflow is never called", async () => {
      const { triggerWorkflow } = await import("../../../src/server/lib/keeperhub-trigger.js");
      await keeperhubApiRoutes.request("/keeperhub/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", confirm: true }),
      });
      expect(triggerWorkflow).not.toHaveBeenCalled();
    });
  });
});
