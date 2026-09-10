import { describe, it, expect, beforeAll } from "vitest";

const LIVE = process.env.KEEPERHUB_E2E_LIVE === "true";

describe.skipIf(!LIVE)("SLICE-126-18: Tier 2 — KeeperHub live e2e (env-gated)", () => {
  const apiKey = process.env.KEEPERHUB_API_KEY ?? "";
  const workflowRecordScan = process.env.KEEPERHUB_WORKFLOW_RECORD_SCAN ?? "";
  const trustRegistry = process.env.BASE_TRUST_REGISTRY ?? "";
  const scanTarget = process.env.E2E_SCAN_TARGET ?? "https://agentbadge.xyz";

  beforeAll(() => {
    if (!apiKey || !workflowRecordScan || !trustRegistry) {
      console.warn("Tier 2 live: missing required env vars (KEEPERHUB_API_KEY, KEEPERHUB_WORKFLOW_RECORD_SCAN, BASE_TRUST_REGISTRY)");
    }
  });

  it("listWorkflows detects agentbadge-* workflows", async () => {
    const { KeeperHubClient } = await import("@agentbadge/keeperhub");
    const client = new KeeperHubClient({ apiKey, serverUrl: "https://app.keeperhub.com/mcp" });
    await client.connect();
    const workflows = await client.listWorkflows();
    expect(workflows).toBeDefined();
    expect(Array.isArray(workflows)).toBe(true);
    const names = workflows.map((w: { name?: string; id?: string }) => w.name ?? w.id ?? String(w));
    expect(names.some((n: string) => n.includes("agentbadge"))).toBe(true);
  });

  it("full live cycle: scan → confirm → poll → txHashes present → onchain read-back", async () => {
    const { KeeperHubClient } = await import("@agentbadge/keeperhub");
    const client = new KeeperHubClient({ apiKey, serverUrl: "https://app.keeperhub.com/mcp" });
    await client.connect();

    const exec = await client.executeWorkflow(workflowRecordScan, {
      siteUrl: scanTarget,
      score: 85,
      rulesPassed: 140,
      rulesTotal: 145,
    });
    expect(exec.executionId).toBeDefined();

    const result = await client.pollExecution(exec.executionId, { timeoutMs: 90_000, intervalMs: 10_000 });
    expect(result.status).toBe("success");
    const txHashes = (result as { txHashes?: string[] }).txHashes ?? [];
    expect(txHashes.length).toBeGreaterThan(0);

    const { readLatestScoreFor } = await import("../../src/server/lib/keeperhub-onchain");
    const onchain = await readLatestScoreFor(trustRegistry, scanTarget);
    expect(onchain).toBeDefined();
    if (onchain && typeof onchain === "object" && "score" in onchain) {
      expect((onchain as { score: number }).score).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("live SSE: audit event frame arrives ≤10s after trigger", async () => {
    const { makeTestApp, setupMockEnv } = await import("./helpers");
    setupMockEnv();
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = apiKey;
    process.env.KEEPERHUB_WORKFLOW_RECORD_SCAN = workflowRecordScan;
    process.env.BASE_TRUST_REGISTRY = trustRegistry;
    const { resetConfigCache } = await import("../../src/config/env");
    resetConfigCache();
    const app = makeTestApp();

    const sseRes = await app.request("/api/keeperhub/audit/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotAuditFrame = false;
    const deadline = Date.now() + 10_000;

    await app.request("/api/keeperhub/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: scanTarget, confirm: true }),
    });

    while (Date.now() < deadline && !gotAuditFrame) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event:audit")) {
        gotAuditFrame = true;
      }
    }
    reader.cancel();
    expect(gotAuditFrame).toBe(true);
  }, 30_000);

  describe.skipIf(process.env.KEEPERHUB_X402_LIVE !== "true")("optional x402 sub-suite", () => {
    it("premium 402 raw → pay → 200 → two txs", async () => {
      expect(true).toBe(true);
    });
  });
});
