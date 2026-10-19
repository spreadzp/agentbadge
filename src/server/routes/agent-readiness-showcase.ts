/**
 * SLICE-201-15: /agent-readiness — dogfooding showcase.
 * GET /agent-readiness      → HTML page (explanation + cached self-scan)
 * GET /agent-readiness.json → machine-readable descriptor (rel=alternate target)
 *
 * The scanner is injected (scanFn) — production wiring uses the local
 * orchestrator (import, no HTTP call); tests inject a mock. The report is
 * cached in-process with ttl ≥ 1h; ?refresh=1 forces a rescan (D-201-22).
 */
import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { AgentReadinessPage, type SelfScanState } from "../../views/agent-readiness-page";
import { BASE_URL } from "../lib/page-meta";
import type { ScanReport } from "../../agent-readiness/report-formatter";

export interface ShowcaseDeps {
  scanFn: () => Promise<ScanReport>;
  target?: string;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // ≥1h per AC

export function createShowcaseRoutes(deps: ShowcaseDeps) {
  const target = deps.target ?? BASE_URL;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? Date.now;
  const app = new Hono();

  let cache: { state: SelfScanState; expiresAt: number } | null = null;
  let inflight: Promise<SelfScanState> | null = null;

  async function scan(): Promise<SelfScanState> {
    try {
      const report = await deps.scanFn();
      return {
        status: "ok",
        report,
        scannedAt: new Date(now()).toISOString(),
      };
    } catch (err) {
      return {
        status: "unavailable",
        report: null,
        scannedAt: new Date(now()).toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function getScan(refresh: boolean): Promise<SelfScanState> {
    if (!refresh && cache && cache.expiresAt > now()) {
      return cache.state;
    }
    if (!refresh && inflight) return inflight;
    inflight = scan().then((state) => {
      cache = { state, expiresAt: now() + ttlMs };
      inflight = null;
      return state;
    });
    return inflight;
  }

  app.get("/agent-readiness", async (c) => {
    const refresh = c.req.query("refresh") === "1";
    const state = await getScan(refresh);
    const content = AgentReadinessPage(state, target).toString();
    const meta = {
      title: "Agent Readiness, on ourselves — AgentBadge",
      description:
        "Our agent-readiness scanner run against this very site: honest verdicts, cached results, and the three representations of every article.",
      path: "/agent-readiness",
      jsonUrl: "/agent-readiness.json",
    };
    const pageHtml = LandingLayout(content, undefined, meta);
    return c.html(pageHtml);
  });

  app.get("/agent-readiness.json", async (c) => {
    const state = await getScan(false);
    return c.json({
      type: "agent-readiness-showcase",
      schemaVersion: "1",
      what: "Agent-Native showcase: our agent-readiness scanner run against this site. Explains the three representations of every article (human HTML, FOR AI AGENTS block, Knowledge Object JSON) and publishes the cached self-scan verdicts.",
      url: `${BASE_URL}/agent-readiness`,
      htmlAlternate: `${BASE_URL}/agent-readiness`,
      scanned: target,
      scan: {
        status: state.status,
        scannedAt: state.scannedAt,
        cacheTtlSeconds: Math.round(ttlMs / 1000),
        ...(state.report
          ? {
              score: state.report.score,
              grade: state.report.grade,
              total_rules: state.report.total_rules,
              verified: state.report.verified,
              missing: state.report.missing,
              not_applicable: state.report.not_applicable,
              assertions: state.report.assertions.map((a) => ({
                rule_id: a.rule_id,
                name: a.name,
                category: a.category,
                status: a.status,
              })),
            }
          : { error: state.error ?? "scan pending" }),
      },
      caveats: [
        "The scan covers the listed target only, not every page.",
        "GAP and NOT_APPLICABLE rules are reported, not hidden.",
        "Results are cached; use ?refresh=1 on the HTML page to rescan.",
      ],
    });
  });

  return app;
}
