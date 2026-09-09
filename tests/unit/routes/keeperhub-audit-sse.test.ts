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

vi.mock("../../../src/agent-readiness/scanner/orchestrator.js", () => ({ scanDomain: vi.fn() }));
vi.mock("../../../src/agent-readiness/rule-engine/rule-engine.js", () => ({ RuleEngine: { run: vi.fn() } }));
vi.mock("../../../src/agent-readiness/report-formatter.js", () => ({ formatScanReport: vi.fn() }));
vi.mock("../../../src/agent-readiness/scanner/ssrf/ip-guard.js", () => ({ assertSafeTarget: vi.fn() }));
vi.mock("../../../src/server/lib/keeperhub.js", () => ({
  getKeeperHubClient: vi.fn(),
  getKeeperHubToolContext: vi.fn(),
  keeperhubDisabledResponse: vi.fn(() => ({ error: "KeeperHub integration not enabled" })),
  resetKeeperHubClient: vi.fn(),
}));
vi.mock("../../../src/server/lib/keeperhub-trigger.js", () => ({ triggerWorkflow: vi.fn() }));
vi.mock("../../../src/server/lib/keeperhub-onchain.js", () => ({
  readLatestScoreFor: vi.fn(),
  readRecentRecords: vi.fn(),
  resetKeeperHubPublicClient: vi.fn(),
}));

// Use real auditStore (not mocked) for SSE EventEmitter behavior
import { auditStore } from "../../../src/server/lib/keeperhub-audit-store";
import { keeperhubApiRoutes } from "../../../src/server/routes/keeperhub-api";

async function readSSEChunk(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("read timeout")), timeoutMs);
    reader.read().then(
      ({ done, value }) => {
        clearTimeout(timer);
        if (done) { resolve(""); return; }
        resolve(new TextDecoder().decode(value));
      },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

describe("SLICE-126-11: GET /keeperhub/audit/stream (SSE)", () => {
  beforeEach(() => {
    auditStore.clear();
    mockConfig.keeperhub = {
      enabled: true,
      apiKey: "kh_test",
      serverUrl: "https://app.keeperhub.com/mcp",
      triggerMode: "mcp",
      webhookUrls: {},
      workflowIds: {},
    };
  });

  afterEach(() => {
    auditStore.removeAllListeners("audit");
  });

  it("406 without Accept: text/event-stream", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(406);
  });

  it("503 disabled", async () => {
    mockConfig.keeperhub = undefined;
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(503);
  });

  it("503 when too many SSE clients (listenerCount >= 40)", async () => {
    // Add 40 dummy listeners to hit the cap
    for (let i = 0; i < 40; i++) {
      auditStore.on("audit", () => {});
    }
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Too many");
  });

  it("response headers: Content-Type, no-cache, X-Accel-Buffering", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    // Cancel the stream to clean up
    await res.body?.cancel();
  });

  it("snapshot on connect: first chunk contains event: snapshot with seeded events", async () => {
    auditStore.add({ source: "test", siteUrl: "https://example.com", status: "recorded", score: 85 });

    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const chunk = await readSSEChunk(reader);
    expect(chunk).toContain("event: snapshot");
    expect(chunk).toContain("https://example.com");
    expect(chunk).toContain("85");

    await reader.cancel();
  });

  it("live audit event: addAuditEvent after subscription → stream yields event: audit", async () => {
    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    // Read the snapshot first
    await readSSEChunk(reader);

    // Now emit a live event
    auditStore.add({ source: "live-test", siteUrl: "https://live.com", status: "recorded", score: 90 });

    const chunk = await readSSEChunk(reader);
    expect(chunk).toContain("event: audit");
    expect(chunk).toContain("live-test");
    expect(chunk).toContain("https://live.com");

    await reader.cancel();
  });

  it("teardown: cancel stream → listener count restored to baseline (no leak)", async () => {
    const baseline = auditStore.listenerCount("audit");

    const res = await keeperhubApiRoutes.request("/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    // Read snapshot
    await readSSEChunk(reader);

    // Listener should have been added
    expect(auditStore.listenerCount("audit")).toBe(baseline + 1);

    // Cancel the stream
    await reader.cancel();
    // Give the abort handler time to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Listener should be removed
    expect(auditStore.listenerCount("audit")).toBe(baseline);
  });
});
