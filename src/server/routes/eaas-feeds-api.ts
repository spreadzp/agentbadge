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
import type { EaasSubscriptionStore } from "../lib/eaas/subscription";
import type { AnchorStore } from "../lib/eaas/anchor";
import { consumerKey, createRateLimiter, bad, HEX32_RE } from "../lib/eaas/request";
import type { ChainService } from "../lib/eaas/chain";
import type { Hex } from "viem";

export interface EaasFeedsDeps {
  store: VerdictStoreBackend;
  requests: EaasRequestStore;
  metrics: EaasMetrics;
  rateRpm: number;
  /** SLICE-154-7: stats — active subscriber + anchor counts. */
  subscriptions?: EaasSubscriptionStore;
  anchors?: AnchorStore;
  /** SLICE-172-4: chain reads — absent = /api/eaas/chain* → 404. */
  chain?: Pick<ChainService, "head" | "entries" | "proofFor">;
  chainId?: number;
  explorerTx?: (txHash: string) => string;
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

  // SLICE-154-7: grant-milestone stats — public aggregate, no wallets.
  routes.get(
    "/api/eaas/stats",
    describeRoute({
      description:
        "Aggregate EaaS counters — verdicts by policy/kind, anchored count, active subscribers",
      responses: { 200: { description: "Aggregate counters" } },
    }),
    (c) => {
      const byPolicy: Record<string, number> = {};
      const byKind: Record<string, number> = {};
      let total = 0;
      for (const v of deps.store.list(undefined, 10_000)) {
        total++;
        byPolicy[v.artifact.policy] = (byPolicy[v.artifact.policy] ?? 0) + 1;
        byKind[v.artifact.kind] = (byKind[v.artifact.kind] ?? 0) + 1;
      }
      const anchors = deps.anchors?.list() ?? [];
      const now = Math.floor(Date.now() / 1000);
      const subs = deps.subscriptions?.list() ?? [];
      const byTier: Record<string, number> = {};
      let active = 0;
      for (const s of subs) {
        if (s.expiresAt > now) {
          active++;
          byTier[s.tier] = (byTier[s.tier] ?? 0) + 1;
        }
      }
      return c.json({
        ok: true,
        verdicts: { total, byPolicy, byKind },
        anchors: {
          total: anchors.length,
          anchored: anchors.filter((a) => a.status === "anchored").length,
          pending: anchors.filter((a) => a.status === "pending").length,
          failed: anchors.filter((a) => a.status === "failed").length,
        },
        subscriptions: { total: subs.length, active, byTier },
        requests: deps.requests.counts(),
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

  // ─── SLICE-172-4: verdict hash-chain reads (free, rate-limited) ──
  const chainOff = (c: { json: (o: unknown, s?: number) => Response }) =>
    c.json({ error: "chain disabled" }, 404);
  const chainGate = (c: Parameters<typeof consumerKey>[0]) =>
    limiter.allow(`chain:${consumerKey(c)}`);

  routes.get(
    "/api/eaas/chain",
    describeRoute({
      description:
        "Verdict hash-chain head: {domain, headHash, count, lastFlushAt, anchor?, chainId} (free, rate-limited)",
      responses: {
        200: { description: "ChainHead + anchor meta" },
        404: { description: "Chain disabled" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) => {
      if (!chainGate(c)) return c.json({ error: "rate limit exceeded" }, 429);
      if (!deps.chain) return chainOff(c);
      const h = deps.chain.head();
      const anchor = h.anchor
        ? {
            epochSeq: h.anchor.epochSeq,
            txHash: h.anchor.txHash,
            blockNumber: h.anchor.blockNumber,
            ...(deps.explorerTx
              ? { explorerUrl: deps.explorerTx(h.anchor.txHash) }
              : {}),
          }
        : undefined;
      return c.json({
        domain: h.domain,
        headHash: h.headHash,
        count: h.count,
        ...(h.lastFlushAt ? { lastFlushAt: h.lastFlushAt } : {}),
        ...(anchor ? { anchor } : {}),
        ...(deps.chainId !== undefined ? { chainId: deps.chainId } : {}),
      });
    },
  );

  routes.get(
    "/api/eaas/chain/entries",
    describeRoute({
      description:
        "Paged chain entries ?from&to&limit — limit capped at 100 (free, rate-limited)",
      responses: {
        200: { description: "{entries: ChainEntry[]}" },
        404: { description: "Chain disabled" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) => {
      if (!chainGate(c)) return c.json({ error: "rate limit exceeded" }, 429);
      if (!deps.chain) return chainOff(c);
      const q = c.req.query();
      const from = Math.max(0, Number.parseInt(q.from ?? "0", 10) || 0);
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(q.limit ?? "100", 10) || 100),
      );
      const toRaw = q.to !== undefined ? Number.parseInt(q.to, 10) : NaN;
      const to = Number.isNaN(toRaw) ? from + limit : Math.min(toRaw, from + limit);
      return c.json({ entries: deps.chain.entries(from, to) });
    },
  );

  routes.get(
    "/api/eaas/chain/proof/:verdictId",
    describeRoute({
      description:
        "Inclusion proof: entry + suffix to head — third party recomputes headHash offline (free, rate-limited)",
      responses: {
        200: { description: "{seq, path, head}" },
        404: { description: "Verdict not in chain / chain disabled" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) => {
      if (!chainGate(c)) return c.json({ error: "rate limit exceeded" }, 429);
      if (!deps.chain) return chainOff(c);
      const id = c.req.param("verdictId");
      if (!HEX32_RE.test(id)) return bad(c, "invalid verdictId");
      const proof = deps.chain.proofFor(id as Hex);
      if (!proof) return c.json({ error: "verdict not in chain" }, 404);
      return c.json({
        seq: proof.entry.seq,
        path: proof.path,
        head: deps.chain.head(),
      });
    },
  );

  return routes;
}
