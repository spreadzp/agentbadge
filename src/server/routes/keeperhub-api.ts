import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { streamSSE } from "hono/streaming";
import { getConfig } from "../../config/env";
import { getKeeperHubClient, keeperhubDisabledResponse } from "../lib/keeperhub";
import { triggerWorkflow } from "../lib/keeperhub-trigger";
import { auditStore, type AuditEvent } from "../lib/keeperhub-audit-store";
import { readLatestScoreFor, readRecentRecords } from "../lib/keeperhub-onchain";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";
import { rulesForPacks, packMetadata } from "../../agent-readiness/rule-packs";
import type { AgentReadinessRule } from "../../agent-readiness/rule.schema";
import { formatScanReport } from "../../agent-readiness/report-formatter";
import { invalidateDomain } from "../lib/cache";
import { assertSafeTarget } from "../../agent-readiness/scanner/ssrf/ip-guard";
import { captureError } from "../lib/sentry";
import {
  activeScans,
  scanDurationMs,
  scansTotal,
} from "../metrics/metrics";

export const keeperhubApiRoutes = new Hono();

// GET /keeperhub/status — health + config probe (no KeeperHub network call)
keeperhubApiRoutes.get(
  "/keeperhub/status",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "KeeperHub integration status and config probe",
    description: "Returns whether KeeperHub is enabled, configured server URL, workflow IDs, and trust contract addresses. No network calls.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);
    return c.json({
      enabled: true,
      serverUrl: cfg.keeperhub.serverUrl,
      workflows: {
        recordScan: cfg.keeperhub.workflowIds.recordScan ?? null,
        mintPassport: cfg.keeperhub.workflowIds.mintPassport ?? null,
        notify: cfg.keeperhub.workflowIds.notify ?? null,
      },
      trustContracts: {
        registry: cfg.base?.trustRegistry ?? null,
        badge: cfg.base?.trustBadge ?? null,
      },
    });
  },
);

// POST /keeperhub/ping — live KeeperHub connectivity (calls list_workflows)
keeperhubApiRoutes.post(
  "/keeperhub/ping",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "Ping KeeperHub MCP server",
    description: "Calls list_workflows on the KeeperHub MCP to verify connectivity. Returns ok or fail with error text (never 500 — observability).",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);
    const client = getKeeperHubClient();
    if (!client) return c.json(keeperhubDisabledResponse(), 503);
    try {
      await client.connect();
      const workflows = await client.listWorkflows();
      return c.json({ ok: true, workflows });
    } catch (e) {
      captureError(e instanceof Error ? e : new Error(String(e)), { route: "ping" });
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
);

// Shared helper: trigger KeeperHub record-scan workflow, poll execution, store audit event.
// Used by both POST /scan (confirm mode) and POST /scan/premium (x402-gated).
async function executeScanRecording(
  c: Context,
  normalizedUrl: string,
  scan: { url: string; score: number; grade: string; rulesPassed: number; rulesTotal: number },
) {
  const cfg = getConfig();
  const workflowId = cfg.keeperhub!.workflowIds.recordScan;
  if (!workflowId) {
    return c.json({ error: "record-scan workflow not provisioned (KEEPERHUB_WORKFLOW_RECORD_SCAN)" }, 502);
  }

  const client = getKeeperHubClient();
  if (!client) return c.json(keeperhubDisabledResponse(), 503);

  await client.connect();

  let triggerResult;
  try {
    triggerResult = await triggerWorkflow(client, workflowId, { siteUrl: normalizedUrl, score: Math.round(scan.score), rulesPassed: scan.rulesPassed, rulesTotal: scan.rulesTotal }, {
      mode: cfg.keeperhub!.triggerMode,
      webhookUrl: cfg.keeperhub!.webhookUrls["record-scan"],
      webhookKey: cfg.keeperhub!.webhookKey,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    captureError(e instanceof Error ? e : new Error(message), { route: "executeScanRecording", stage: "trigger", siteUrl: normalizedUrl });
    return c.json({ error: message, hint: "check KEEPERHUB_API_KEY / connectivity" }, 502);
  }

  try {
    const exec = await client.pollExecution(triggerResult.executionId, { timeoutMs: 300_000, intervalMs: 3000 });
    const txHashes = client.txHashes(exec);
    await auditStore.add({
      source: "agentbadge-record-scan",
      siteUrl: normalizedUrl,
      score: scan.score,
      status: "recorded",
      txHashes,
      executionId: triggerResult.executionId,
    });
    return c.json({ mode: "executed", via: triggerResult.via, executionId: triggerResult.executionId, status: exec.status, txHashes, scan });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await auditStore.add({
      source: "agentbadge-record-scan",
      siteUrl: normalizedUrl,
      score: scan.score,
      status: "failed",
      executionId: triggerResult.executionId,
      error: message,
    });
    captureError(new Error(message), { route: "executeScanRecording", stage: "poll", executionId: triggerResult.executionId, siteUrl: normalizedUrl });
    return c.json({ mode: "failed", executionId: triggerResult.executionId, error: message });
  }
}

/**
 * Fast parallel fetchers only — skips the 5 slow sequential probes
 * (guide, openapi, mcp, operational_discovery, credential_security).
 * ~20 resources, all concurrent → scan completes in ~10-20s instead of ~2min.
 * Rules depending on skipped resources become NOT_APPLICABLE and are
 * excluded from the score denominator, so the result stays honest.
 */
const QUICK_SCAN_RESOURCES = [
  "robots", "sitemap", "llms", "content_negotiation", "openapi_standard",
  "agents_txt", "webmcp", "llms_full", "rss_feed", "mcp_probe",
  "homepage_meta", "infrastructure", "identity", "favicon", "pricing",
  "link_headers", "og_meta", "semantic_html", "accessibility", "agent_card",
];

// GET /keeperhub/packs — rule-pack marketplace metadata (name, description, price, fast)
keeperhubApiRoutes.get(
  "/keeperhub/packs",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "List available rule packs with marketplace metadata",
    description: "Returns pack id, name, description, price (null = free), and fast-profile eligibility. Pass ?packs=a,b to filter.",
  }),
  (c) => {
    const q = c.req.query("packs");
    const packIds = q ? q.split(",").map((p) => p.trim()).filter(Boolean) : undefined;
    return c.json({ packs: packMetadata(packIds) });
  },
);

keeperhubApiRoutes.post(
  "/keeperhub/scan",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "Scan a URL and optionally trigger KeeperHub record-scan workflow",
    description: "Dry-run mode (default) returns scan results + preview of onchain functionArgs. Confirm mode triggers KeeperHub workflow, polls execution, and stores audit event.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);

    let body: { url?: string; confirm?: boolean; quick?: boolean; packs?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const rawUrl = body.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return c.json({ error: "Missing required field: url" }, 400);
    }

    const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    try {
      new URL(normalizedUrl);
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }

    const hostname = new URL(normalizedUrl).hostname;
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    const quick = body.quick === true;
    let score: number, grade: string, rulesPassed: number, rulesTotal: number;
    activeScans.inc();
    const scanStart = Date.now();
    try {
      const sourceState = await scanDomain(normalizedUrl, quick ? { resources: [...QUICK_SCAN_RESOURCES] } : {});
      const result = RuleEngine.run(sourceState);
      const packList = Array.isArray(body.packs) ? body.packs.filter((p) => typeof p === "string") : [];
      if (packList.length > 0) {
        const packRuleIds = new Set(rulesForPacks(packList, AGENT_READINESS_RULESET.rules as AgentReadinessRule[]).map((r) => r.rule_id));
        result.assertions = result.assertions.filter((a) => packRuleIds.has(a.rule_id));
      }
      const report = formatScanReport(normalizedUrl, result);
      score = report.score;
      grade = report.grade;
      rulesPassed = report.verified;
      rulesTotal = report.total_rules;
      scansTotal.inc({ result: "success" });
    } catch (err) {
      scansTotal.inc({ result: "error" });
      const message = err instanceof Error ? err.message : "Unknown error";
      captureError(err instanceof Error ? err : new Error(message), { route: "scan", stage: "orchestrator", siteUrl: normalizedUrl });
      return c.json({ error: `Scan failed: ${message}` }, 500);
    } finally {
      activeScans.dec();
      scanDurationMs.observe(Date.now() - scanStart);
    }

    const scan = { url: normalizedUrl, score, grade, rulesPassed, rulesTotal, depth: quick ? "quick" as const : "full" as const };

    // Dry-run mode (default)
    if (body.confirm !== true) {
      return c.json({
        mode: "dry-run",
        scan,
        wouldExecute: {
          workflow: "agentbadge-record-scan",
          workflowId: cfg.keeperhub.workflowIds.recordScan ?? null,
          network: "84532",
          contract: "TrustRegistry",
          functionArgs: [normalizedUrl, score, rulesPassed, rulesTotal],
        },
        confirmHint: "POST again with confirm: true",
      });
    }

    // Confirm mode — use shared helper
    return executeScanRecording(c, normalizedUrl, scan);
  },
);

// POST /keeperhub/scan/premium — x402-gated premium onchain recording
keeperhubApiRoutes.post(
  "/keeperhub/scan/premium",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "Premium scan recording via x402 payment (EIP-3009 USDC)",
    description: "Identical to POST /scan with confirm:true, but gated behind x402 payment middleware. Free alternative: POST /api/keeperhub/scan with confirm:true.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);
    if (!cfg.keeperhub.x402?.enabled) {
      return c.json({ error: "x402 premium disabled", freeAlternative: "POST /api/keeperhub/scan {url, confirm:true}" }, 503);
    }

    let body: { url?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const rawUrl = body.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return c.json({ error: "Missing required field: url" }, 400);
    }

    const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    try {
      new URL(normalizedUrl);
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }

    const hostname = new URL(normalizedUrl).hostname;
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    let score: number, grade: string, rulesPassed: number, rulesTotal: number;
    activeScans.inc();
    const scanStart = Date.now();
    try {
      const sourceState = await scanDomain(normalizedUrl, {});
      const result = RuleEngine.run(sourceState);
      const report = formatScanReport(normalizedUrl, result);
      score = report.score;
      grade = report.grade;
      rulesPassed = report.verified;
      rulesTotal = report.total_rules;
      scansTotal.inc({ result: "success" });
      // EPIC-144: rescan completed — drop domain-tagged cache (badge etc).
      void invalidateDomain(hostname);
    } catch (err) {
      scansTotal.inc({ result: "error" });
      const message = err instanceof Error ? err.message : "Unknown error";
      captureError(err instanceof Error ? err : new Error(message), { route: "scan/premium", stage: "orchestrator", siteUrl: normalizedUrl });
      return c.json({ error: `Scan failed: ${message}` }, 500);
    } finally {
      activeScans.dec();
      scanDurationMs.observe(Date.now() - scanStart);
    }

    const scan = { url: normalizedUrl, score, grade, rulesPassed, rulesTotal };
    return executeScanRecording(c, normalizedUrl, scan);
  },
);

// POST /keeperhub/audit/webhook — callback receiver for KeeperHub workflow callbacks
keeperhubApiRoutes.post(
  "/keeperhub/audit/webhook",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "Webhook receiver for KeeperHub audit callbacks",
    description: "Receives callback POSTs from KeeperHub workflow audit-callback nodes. Validates secret when configured. Coerces string values to numbers.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);

    // Secret validation when configured
    if (cfg.keeperhub.auditSecret) {
      const authHeader = c.req.header("Authorization") ?? "";
      const expected = `Bearer ${cfg.keeperhub.auditSecret}`;
      if (authHeader !== expected) {
        return c.json({ error: "Unauthorized: invalid or missing secret" }, 401);
      }
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Coerce string values to numbers for score/rulesPassed/rulesTotal
    const coerceNum = (v: unknown): number | undefined => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number(v);
        if (!isNaN(n)) return n;
      }
      return undefined;
    };

    const source = (body.source as string) ?? "keeperhub-callback";
    const siteUrl = (body.siteUrl as string) ?? (body.url as string) ?? "";
    const score = coerceNum(body.score);
    const executionId = body.executionId as string | undefined;

    await auditStore.add({
      source,
      siteUrl,
      score,
      status: "recorded",
      executionId,
      txHashes: [],
    });

    return c.json({ ok: true });
  },
);

// GET /keeperhub/audit — audit trail with optional onchain enrichment
keeperhubApiRoutes.get(
  "/keeperhub/audit",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "Audit trail events with optional onchain enrichment",
    description: "Returns in-memory audit events (newest first) with optional onchain reads from TrustRegistry. Graceful degradation: onchain failures return null, not 500.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);

    const siteUrl = c.req.query("siteUrl");
    const rawLimit = Number(c.req.query("limit") ?? 50);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 100);
    const onchainFlag = c.req.query("onchain") !== "false";

    const events = await auditStore.list({ limit, siteUrl });

    let onchain: { latest?: unknown; recent?: unknown; source: string | null } = {
      source: cfg.base?.trustRegistry ?? null,
    };

    if (onchainFlag && cfg.base?.trustRegistry) {
      try {
        if (siteUrl) {
          onchain.latest = await readLatestScoreFor(cfg.base.trustRegistry, siteUrl);
        } else {
          onchain.recent = await readRecentRecords(cfg.base.trustRegistry, Math.min(limit, 20));
        }
      } catch {
        onchain = { source: cfg.base.trustRegistry };
      }
    }

    return c.json({
      events,
      onchain,
      explorer: {
        name: "Basescan",
        txUrlTemplate: "https://sepolia.basescan.org/tx/{hash}",
      },
    });
  },
);

// GET /keeperhub/audit/stream — SSE stream of audit events
keeperhubApiRoutes.get(
  "/keeperhub/audit/stream",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "SSE stream of audit events",
    description: "Server-Sent Events stream: snapshot on connect, live audit events, 25s heartbeat. Max 40 concurrent clients.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);

    const accept = c.req.header("Accept") ?? "";
    if (!accept.includes("text/event-stream")) {
      return c.json({ error: "Not Acceptable: client must accept text/event-stream" }, 406);
    }

    if (auditStore.listenerCount("audit") >= 40) {
      return c.json({ error: "Too many SSE clients" }, 503);
    }

    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      // Subscribe + abort-cleanup FIRST — both must be registered before
      // any await so a live event or a client cancel landing during the
      // async snapshot read is never missed.
      const onAudit = async (event: AuditEvent) => {
        await stream.writeSSE({ event: "audit", data: JSON.stringify(event) });
      };
      auditStore.on("audit", onAudit);
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      stream.onAbort(() => {
        auditStore.off("audit", onAudit);
        if (heartbeat) clearInterval(heartbeat);
      });

      // Initial snapshot
      const snapshot = await auditStore.list({ limit: 20 });
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ events: snapshot }) });

      // Heartbeat every 25s
      heartbeat = setInterval(() => {
        stream.writeSSE({ data: "ping", event: "" }).catch(() => { });
      }, 25_000);

      // Keep stream open until aborted
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (stream.aborted) break;
      }
    });
  },
);
