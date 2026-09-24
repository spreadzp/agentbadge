import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../agent-readiness/report-formatter";
import { assertSafeTarget } from "../../agent-readiness/scanner/ssrf/ip-guard";
import { runScoringEngine } from "../../agent-readiness/scoring/scoring-engine";
import { summarizeGaps } from "../../agent-readiness/gap-engine/gap-engine";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";
import { BUNDLE_IDS, resolveBundleIds } from "../../agent-readiness/rule-bundles";
import { getConfig } from "../../config/env";
import { hookScanToCorpus } from "../../agent-readiness/corpus/corpus-hook";
import { invalidateDomain } from "../lib/cache";
import { normalizeDomain, recordScanResult } from "../services/scan-store";
import { FileCorpusStore } from "../../agent-readiness/corpus/corpus-store";

export const totalScanRoutes = new Hono();

totalScanRoutes.post(
  "/total-scan",
  describeRoute({
    tags: ["API"],
    summary: "Run a full agent readiness scan with SSE streaming",
    description:
      "Streams scan progress and results via Server-Sent Events. Returns progress events during fetch/evaluate phases, then a result event with the full report, then a done event. " +
      "Optional `packs: string[]` scopes the scan to rule bundles (see GET /api/scan-packs for valid ids; legacy pack aliases accepted). " +
      "Auth: access pass via X-Wallet/X-Sig/X-Timestamp (EIP-191 signature over the agentbadge-access:v1 challenge — see docs/agent-access.md), or x402 payment.",
    parameters: [
      {
        name: "X-Wallet",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "Agent wallet address (EOA or ERC-1271 contract wallet) holding a valid access pass",
      },
      {
        name: "X-Sig",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "EIP-191 signature over the canonical challenge (agentbadge-access:v1, wallet, method, path, timestamp)",
      },
      {
        name: "X-Timestamp",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "Unix seconds, ±300s skew window — must match the timestamp in the signed challenge",
      },
    ],
    responses: {
      200: { description: "SSE stream of scan progress and results" },
      400: { description: "Missing or invalid URL, or unknown bundle ids" },
      401: { description: "Missing/invalid auth headers, stale timestamp, or signature verification failed" },
      402: {
        description:
          "Payment required (x402). PAYMENT-REQUIRED header carries base64-encoded payment requirements " +
          "(accepts: scheme exact, network eip155:84532, USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e, atomic amount). " +
          "Body lists per-bundle pricing.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", example: "Payment required" },
                packs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", example: "discovery-crawling" },
                      price: {
                        type: "object",
                        properties: {
                          amount: { type: "string", example: "0.30" },
                          currency: { type: "string", example: "USDC" },
                        },
                      },
                      ruleCount: { type: "integer", example: 19 },
                    },
                  },
                },
                totalPrice: {
                  type: "object",
                  properties: {
                    amount: { type: "string", example: "4.50" },
                    currency: { type: "string", example: "USDC" },
                  },
                },
              },
            },
          },
        },
      },
    },
  }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const url = (body as Record<string, unknown>)?.url;
    if (!url || typeof url !== "string") {
      return c.json({ error: "URL is required" }, 400);
    }

    // EPIC-133: optional `packs` — bundle-scoped fetch + rules (D4).
    // Gated by scanPacks.enabled: off → packs silently ignored (full scan).
    // `options` is accepted but reserved for future use (D3).
    let packs: string[] | undefined;
    const rawPacks = (body as Record<string, unknown>)?.packs;
    if (getConfig().scanPacks.enabled && Array.isArray(rawPacks) && rawPacks.length > 0) {
      if (!rawPacks.every((p) => typeof p === "string")) {
        return c.json({ error: "packs must be an array of strings" }, 400);
      }
      const { ok, unknown } = resolveBundleIds(rawPacks as string[]);
      if (unknown.length > 0) {
        return c.json(
          { error: `Unknown bundle(s): ${unknown.join(", ")}`, unknown, validIds: BUNDLE_IDS },
          400,
        );
      }
      packs = ok;
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }

    // SSRF protection: canonical guard (replaces inline blocklist)
    const hostname = new URL(normalizedUrl).hostname;
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return streamText(c, async (stream) => {
      // Phase 1: Fetch resources with per-resource progress
      const sourceState = await scanDomain(normalizedUrl, {
        bundles: packs,
        onProgress: (resource, completed, total) => {
          stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "fetching", resource, completed, total })}\n\n`);
        },
      });

      // Phase 2: Run rules
      await stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "evaluating", completed: 0, total: 0 })}\n\n`);

      const result = RuleEngine.run(sourceState, { packs });

      await stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "evaluating", completed: result.assertions.length, total: result.totalRules })}\n\n`);

      // Phase 3: Format and send report (pack-scoped → bundleScores + upsell)
      const report = formatScanReport(normalizedUrl, result, { packs });

      await stream.write(`event: result\ndata: ${JSON.stringify(report)}\n\n`);
      await stream.write(`event: done\ndata: ${JSON.stringify({ completed: true })}\n\n`);

      // EPIC-145 (SLICE-145-2): persist scan result — fire-and-forget,
      // never blocks or breaks the streamed response.
      const domain = normalizeDomain(hostname);
      recordScanResult({
        domain,
        url: normalizedUrl,
        score: report.score,
        report: { scanReport: report, assertions: result.assertions },
        rulesetVersion: AGENT_READINESS_RULESET.version,
      });
      void invalidateDomain(domain);

      // Fire-and-forget: hook scan result into corpus (SLICE-103-2)
      try {
        const manifest = {
          version: AGENT_READINESS_RULESET.version,
          scoring: AGENT_READINESS_RULESET.scoring,
          categoryWeights: {},
        };
        const scoreResult = runScoringEngine({ assertions: result.assertions, rulesetManifest: manifest as unknown as Parameters<typeof runScoringEngine>[0]["rulesetManifest"] });
        const gaps = result.assertions
          .filter((a) => a.status === "GAP")
          .map((a) => ({ gap_id: `gap:${a.category}:${a.rule_id}`, category: a.category, priority: a.severity ?? "MEDIUM", type: "documentation" }));
        const gapSummary = summarizeGaps(gaps as unknown as Parameters<typeof summarizeGaps>[0]);
        const corpusStore = new FileCorpusStore();
        hookScanToCorpus({ result, scoreResult, gapSummary }, corpusStore).catch(() => { });
      } catch {
        // Corpus hook must never affect scan response
      }
    });
  },
);
