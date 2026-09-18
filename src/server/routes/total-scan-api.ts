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
import { FileCorpusStore } from "../../agent-readiness/corpus/corpus-store";

export const totalScanRoutes = new Hono();

totalScanRoutes.post(
  "/total-scan",
  describeRoute({
    tags: ["API"],
    summary: "Run a full agent readiness scan with SSE streaming",
    description:
      "Streams scan progress and results via Server-Sent Events. Returns progress events during fetch/evaluate phases, then a result event with the full report, then a done event. " +
      "Optional `packs: string[]` scopes the scan to rule bundles (see GET /api/scan-packs for valid ids; legacy pack aliases accepted).",
    responses: {
      200: { description: "SSE stream of scan progress and results" },
      400: { description: "Missing or invalid URL, or unknown bundle ids" },
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
