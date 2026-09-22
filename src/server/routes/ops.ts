// EPIC-140 (SLICE-140-7): ops routes extracted from index.ts.
// Health (deduped — one handler, two mounts), /api/* → root redirects,
// /market → /services/marketplace, POST /api/indexnow (adminAuth).

import { Hono, type Context } from "hono";
import { listTools } from "@agentbadge/mcp";
import { logger } from "@agentbadge/passport";
import { APP_VERSION, BUILD_DATE, GIT_COMMIT } from "../lib/build-info";
import { isStripeConfigured } from "../lib/stripe-client";
import { adminAuth } from "../middleware/adminAuth";
import { getDatabase } from "../lib/database";
import { getCache } from "../lib/cache";
import { getConfig } from "../../config/env";

export const opsRoutes = new Hono();

const healthHandler = async (c: Context) => {
  const tools = listTools();
  // EPIC-143: db status — "disabled" when DATABASE_ENABLED is unset/false,
  // otherwise a live SELECT 1 probe.
  const database = getDatabase();
  const dbStatus = database.db
    ? (await database.health())
      ? "up"
      : "down"
    : "disabled";
  // EPIC-144: cache status — "disabled" when CACHE_ENABLED is unset/false,
  // otherwise a live provider health probe (PING for Redis backends).
  const cacheSection = getConfig().cache;
  const cacheStatus = cacheSection?.enabled
    ? (await getCache().health())
      ? "up"
      : "down"
    : "disabled";
  return c.json({
    status: "healthy",
    version: APP_VERSION,
    buildDate: BUILD_DATE,
    gitCommit: GIT_COMMIT,
    uptime: process.uptime(),
    db: dbStatus,
    cache: {
      status: cacheStatus,
      backend: cacheSection?.enabled ? (cacheSection.backend ?? "memory") : null,
    },
    mcp: {
      toolsCount: tools.length,
      tools: tools.map((t) => t.name),
    },
    payments: {
      stripe: isStripeConfigured() ? "configured" : "not_configured",
    },
    timestamp: Date.now(),
  });
};

opsRoutes.get("/health", healthHandler);
// SLICE-121-2: API alias routes — mirror root endpoints under /api/ for AI-agent convention
opsRoutes.get("/api/health", healthHandler);

opsRoutes.get("/api/catalog", (c) => c.redirect("/catalog", 301));
opsRoutes.get("/api/audit/:tokenId?/:serial?", (c) => {
  const tokenId = c.req.param("tokenId");
  const serial = c.req.param("serial");
  const path = serial ? `/audit/${tokenId}/${serial}` : tokenId ? `/audit/${tokenId}` : "/audit";
  return c.redirect(path, 301);
});
opsRoutes.all("/api/passport/request", (c) => c.redirect("/passport/request", 301));
// SLICE-131-2: /market landing moved to /services/marketplace (GSC BUG-2)
opsRoutes.get("/market", (c) => c.redirect("/services/marketplace", 301));

const INDEXNOW_KEY = "6abf90e7f0354fb09ac01108f46a17e7";
const INDEXNOW_BASE = "https://agentbadge.xyz";
const INDEXNOW_ALLOWED_HOSTS = (process.env.INDEXNOW_ALLOWED_HOSTS ?? "agentbadge.xyz").split(",");
const INDEXNOW_MAX_URLS = 10;

opsRoutes.post("/api/indexnow", adminAuth, async (c) => {
  try {
    const body = await c.req.json<{ urls?: string[] }>();
    const urls = body.urls ?? [`${INDEXNOW_BASE}/`];

    if (urls.length > INDEXNOW_MAX_URLS) {
      return c.json({ error: `Too many URLs (max ${INDEXNOW_MAX_URLS})` }, 400);
    }

    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (!INDEXNOW_ALLOWED_HOSTS.includes(parsed.hostname)) {
          return c.json({ error: `URL not allowed: ${u}` }, 403);
        }
      } catch {
        return c.json({ error: `Invalid URL: ${u}` }, 400);
      }
    }

    const payload = {
      host: "agentbadge.xyz",
      key: INDEXNOW_KEY,
      keyLocation: `${INDEXNOW_BASE}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    };
    const resp = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });

    logger.info("IndexNow submitted", { urlCount: urls.length });

    return c.json({ ok: resp.ok, status: resp.status, urls: urls.length });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});
