import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../agent-readiness/report-formatter";

export const totalScanRoutes = new Hono();

type AssertionLike = {
  rule_id: string;
  status: string;
  evidence?: unknown[];
  category?: string;
  name?: string;
};

function buildRuleSummary(status: string): string {
  switch (status) {
    case "VERIFIED":
      return "This rule is fully implemented.";
    case "INFERRED":
      return "This rule is partially implemented.";
    case "CONFLICT":
      return "Conflicting evidence found.";
    case "MISSING":
      return "This rule is not implemented.";
    case "NOT_APPLICABLE":
      return "This rule does not apply to your site.";
    default:
      return "Unknown status.";
  }
}

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
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const url = body?.url;
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

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return streamText(c, async (stream) => {
      await stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "fetching", completed: 0, total: 25 })}\n\n`);

      const sourceState = await scanDomain(normalizedUrl);

      await stream.write(`event: progress\ndata: ${JSON.stringify({ phase: "evaluating", completed: 0, total: 72 })}\n\n`);

      const result = RuleEngine.run(sourceState);
      const report = formatScanReport(normalizedUrl, result);

      await stream.write(`event: result\ndata: ${JSON.stringify(report)}\n\n`);
      await stream.write(`event: done\ndata: ${JSON.stringify({ completed: true })}\n\n`);
    });
  },
);
