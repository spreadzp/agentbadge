import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../agent-readiness/report-formatter";
import { assertSafeTarget } from "../../agent-readiness/scanner/ssrf/ip-guard";

export const totalScanRoutes = new Hono();

totalScanRoutes.post(
  "/total-scan",
  describeRoute({
    tags: ["API"],
    summary: "Run a full agent readiness scan with SSE streaming",
    description: "Streams scan progress and results via Server-Sent Events. Returns progress events during fetch/evaluate phases, then a result event with the full report, then a done event.",
    responses: {
      200: { description: "SSE stream of scan progress and results" },
      400: { description: "Missing or invalid URL" },
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
        onProgress: (resource, completed, total) => {
          stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "fetching", resource, completed, total })}\n\n`);
        },
      });

      // Phase 2: Run rules
      await stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "evaluating", completed: 0, total: 0 })}\n\n`);

      const result = RuleEngine.run(sourceState);

      await stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "evaluating", completed: result.assertions.length, total: result.totalRules })}\n\n`);

      // Phase 3: Format and send report
      const report = formatScanReport(normalizedUrl, result);

      await stream.write(`event: result\ndata: ${JSON.stringify(report)}\n\n`);
      await stream.write(`event: done\ndata: ${JSON.stringify({ completed: true })}\n\n`);
    });
  },
);
