/**
 * SLICE-154-6: EaaS delivery surface — async request status, consumer
 * pull-feed, and public SLA status.
 *
 *   GET /api/eaas/requests/:id   — {status, artifact?} for a 202'd request
 *   GET /api/eaas/feed           — ?wallet=0x..&since=<unix>&limit≤100
 *   GET /api/eaas/status         — uptime + avg latency + delivery rate
 *
 * Feed is public (artifacts are self-contained public records); `since`
 * is a strict-lower-bound unix-second cursor, limit defaults to 50.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { VerdictStoreBackend } from "../lib/eaas/store";
import type { EaasRequestStore } from "../lib/eaas/requests";
import type { EaasMetrics } from "../lib/eaas/metrics";
import { consumerKey, createRateLimiter, bad } from "../lib/eaas/request";

export interface EaasFeedsDeps {
  store: VerdictStoreBackend;
  requests: EaasRequestStore;
  metrics: EaasMetrics;
  rateRpm: number;
}

const REQUEST_ID_RE = /^req_[0-9a-f]{16}$/;
const FEED_MAX_LIMIT = 100;
const FEED_DEFAULT_LIMIT = 50;

export function createEaasFeedsRoutes(deps: EaasFeedsDeps): Hono {
  const routes = new Hono();
  const limiter = createRateLimiter(deps.rateRpm);

  routes.get(
    "/api/eaas/requests/:id",
    describeRoute({
      description:
        "Poll an async verdict request (202 from POST /verdicts or /jobs/evaluate)",
      responses: {
        200: { description: "{status: pending|done|failed, artifact?}" },
        404: { description: "Not found" },
      },
    }),
    (c) => {
      const id = c.req.param("id");
      if (!REQUEST_ID_RE.test(id)) return bad(c, "invalid request id");
      const req = deps.requests.get(id);
      if (!req) return c.json({ error: "request not found" }, 404);
      return c.json({
        id: req.id,
        status: req.status,
        kind: req.kind,
        createdAt: req.createdAt,
        ...(req.completedAt ? { completedAt: req.completedAt } : {}),
        ...(req.artifact ? { artifact: req.artifact } : {}),
        ...(req.error ? { error: req.error } : {}),
        ...(req.webhookUrl
          ? {
            webhook: {
              url: req.webhookUrl,
              attempts: req.attempts,
              status: req.webhookStatus ?? "pending",
            },
          }
          : {}),
      });
    },
  );

  routes.get(
    "/api/eaas/feed",
    describeRoute({
      description:
        "Pull-feed of a consumer's verdicts — ?wallet=&since=<unix>&limit≤100 (cursor)",
      responses: {
        200: { description: "{verdicts, nextSince}" },
        400: { description: "wallet required / bad params" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) => {
      if (!limiter.allow(`feed:${consumerKey(c)}`)) {
        return c.json({ error: "rate limit exceeded" }, 429);
      }
      const wallet = c.req.query("wallet");
      if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        return bad(c, "wallet (0x…) required");
      }
      let since = 0;
      const sinceRaw = c.req.query("since");
      if (sinceRaw !== undefined) {
        since = Number.parseInt(sinceRaw, 10);
        if (!Number.isFinite(since) || since < 0) {
          return bad(c, "since must be a unix-seconds integer");
        }
      }
      let limit = FEED_DEFAULT_LIMIT;
      const limitRaw = c.req.query("limit");
      if (limitRaw !== undefined) {
        limit = Number.parseInt(limitRaw, 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > FEED_MAX_LIMIT) {
          return bad(c, `limit must be 1..${FEED_MAX_LIMIT}`);
        }
      }

      // Newest-first page over wallet verdicts; `since` filters by issuedAt.
      const page = deps.store
        .list(wallet)
        .filter((v) => Date.parse(v.artifact.issuedAt) / 1000 > since)
        .slice(0, limit);
      const newest = page[0]?.artifact.issuedAt;
      return c.json({
        verdicts: page.map((v) => ({
          artifact: v.artifact,
          paymentTx: v.paymentTx,
        })),
        // Feed cursor = newest seen issuedAt (unix s); poll with it.
        nextSince: newest
          ? Math.floor(Date.parse(newest) / 1000)
          : since,
      });
    },
  );

  routes.get(
    "/api/eaas/status",
    describeRoute({
      description:
        "Public EaaS SLA status — uptime, avg verdict latency, webhook delivery rate",
      responses: { 200: { description: "SLA snapshot" } },
    }),
    (c) => {
      const snap = deps.metrics.snapshot();
      return c.json({
        ok: true,
        uptimeSec: snap.uptimeSec,
        verdicts: snap.verdicts,
        webhooks: snap.webhooks,
        requests: deps.requests.counts(),
      });
    },
  );

  return routes;
}
