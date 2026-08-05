import { Hono } from "hono";
import { BadgeCache, type CacheEntry } from "./badge-cache";
import { generateBadgeSvg } from "./svg-generator";
import { checkStaleness } from "./ttl-manager";
import type { AgentReadinessReport } from "../report.schema";

export interface BadgeRouteEnv {
  cache: BadgeCache;
  reportStore: ReportStore;
  ttlDays?: number;
}

export interface ReportStore {
  get(scope: string): Promise<AgentReadinessReport | null>;
}

export function createBadgeApp(env: BadgeRouteEnv): Hono {
  const app = new Hono();
  const cache = env.cache;
  const reportStore = env.reportStore;
  const ttlDays = env.ttlDays ?? 7;

  app.get("/badge/:scope", async (c) => {
    const rawScope = c.req.param("scope");
    if (!rawScope) {
      return c.text("Missing scope parameter", 400);
    }
    const scope = rawScope.replace(/\.svg$/, "");

    // Check cache first
    const cached = cache.get(scope);
    if (cached) {
      const ttlResult = checkStaleness(
        new Date(cached.generatedAt).toISOString(),
        ttlDays,
      );
      c.header("Content-Type", "image/svg+xml");
      c.header("Cache-Control", "public, max-age=3600");
      c.header("X-AgentBadge-Stale", String(ttlResult.stale));
      return c.body(cached.svg);
    }

    // Cache miss — load report
    const report = await reportStore.get(scope);
    if (!report) {
      return c.text("Not found", 404);
    }

    const scannedAt = report.scanned_at;
    const score = report.score.total;
    const rulesetVersion = report.ruleset.version;
    const reportId = report.report_id;

    // Check staleness of the report
    const ttlResult = checkStaleness(scannedAt, ttlDays);

    // Generate SVG
    const svg = generateBadgeSvg({
      scope,
      score,
      rulesetVersion,
      scannedAt,
      reportUrl: `https://agentbadge.dev/r/${reportId}`,
      stale: ttlResult.stale,
    });

    // Cache the result
    const entry: CacheEntry = {
      svg,
      generatedAt: new Date().toISOString(),
      reportId,
    };
    cache.set(scope, entry);

    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "public, max-age=3600");
    c.header("X-AgentBadge-Stale", String(ttlResult.stale));
    return c.body(svg);
  });

  return app;
}
