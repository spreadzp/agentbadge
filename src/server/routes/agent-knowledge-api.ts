/**
 * EPIC-229 (SLICE-229-5, D-229-4): public agent knowledge surface —
 *   GET /api/v1/agent/knowledge/search?q=&limit=&kind=&capability=
 *
 * Agent reads are HARD-FORCED to status=PUBLISHED — draft/pending/
 * verified content never crosses this boundary (projection-leak
 * guard, adversarial checklist [K]). Query text flows only through
 * store.searchItems → plainto_tsquery parameterization — no raw
 * tsquery is ever built from input. Tiered rate limits (228 O-228-1
 * pattern); agentKeyAuth already ran globally — identity only widens
 * the limit bucket here.
 */

import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { resolveClientIp } from "../middleware/rate-limit";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  KNOWLEDGE_KINDS,
  composeAnswer,
  searchKnowledgeItems,
  type KnowledgeGapRecorder,
} from "../lib/knowledge";
import {
  createTieredLimiter,
  type TieredLimiter,
} from "./agent-interaction/rate-limits";

const Q_MIN = 2;
const Q_MAX = 200;
const LIMIT_MAX = 20;
const LIMIT_DEFAULT = 10;

/** Read-tier limits — search is cheap + agents poll it repeatedly. */
const SEARCH_TIER_LIMITS = { ANON: 10, API_KEY: 60, DID: 120 } as const;
const SEARCH_GLOBAL_MAX = SEARCH_TIER_LIMITS.DID * 10;

function tierOf(c: Context): keyof typeof SEARCH_TIER_LIMITS {
  if (c.get("verifiedDid")) return "DID";
  return c.get("agentId") ? "API_KEY" : "ANON";
}

function searchLimiterKey(c: Context): string {
  const did = c.get("verifiedDid");
  if (typeof did === "string" && did.length > 0) return `did:${did}`;
  const agentId = c.get("agentId");
  if (typeof agentId === "string" && agentId.length > 0) {
    return `key:${agentId}`;
  }
  return `ip:${resolveClientIp(c)}:${c.req.path}`;
}

function tooMany(c: Context) {
  return errorResponse(
    c,
    429,
    ErrorCodes.RATE_LIMITED,
    "rate limit exceeded for knowledge search",
    { retryable: true },
  );
}

const askBodySchema = z.object({
  query: z.string().min(2).max(500),
});

export interface AgentKnowledgeDeps {
  store: KnowledgeStore;
  limiter?: TieredLimiter;
  gapRecorder?: KnowledgeGapRecorder;
}

export function createAgentKnowledgeRoutes(
  deps: AgentKnowledgeDeps,
): Hono {
  const app = new Hono();
  const { store } = deps;
  const limiter =
    deps.limiter ??
    createTieredLimiter({
      limits: SEARCH_TIER_LIMITS,
      globalKey: "g:knowledge-search",
      globalMax: SEARCH_GLOBAL_MAX,
    });

  const rateLimit: MiddlewareHandler = async (c, next: Next) => {
    if (!limiter.allow(tierOf(c), searchLimiterKey(c))) {
      return tooMany(c);
    }
    return next();
  };

  app.get(
    "/api/v1/agent/knowledge/search",
    rateLimit,
    describeRoute({
      summary: "Search published knowledge — deterministic FTS",
      tags: ["Agent Knowledge"],
      responses: {
        200: { description: "{results, query, tookMs, engine}" },
        400: { description: "Query/kind/limit validation failure" },
        429: { description: "Rate limit" },
      },
    }),
    async (c) => {
      const started = Date.now();
      const q = (c.req.query("q") ?? "").trim();
      if (q.length < Q_MIN || q.length > Q_MAX) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `q must be ${Q_MIN}..${Q_MAX} chars`,
        );
      }
      const kind = c.req.query("kind");
      if (kind !== undefined && !KNOWLEDGE_KINDS.includes(kind as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad kind");
      }
      const limitParam = Number(c.req.query("limit") ?? String(LIMIT_DEFAULT));
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(Math.floor(limitParam), LIMIT_MAX)
          : LIMIT_DEFAULT;
      const capability = c.req.query("capability");

      const res = await searchKnowledgeItems(store, q, {
        status: "PUBLISHED", // hard-forced — never a caller knob
        kind: kind ?? null,
        capabilityRef: capability ?? null,
        limit,
      });
      return c.json({
        results: res.items.map((h) => ({
          itemId: h.itemId,
          slug: h.slug,
          kind: h.kind,
          title: h.title,
          summary: h.summary,
          snippet: h.snippet,
          rank: h.rank,
        })),
        query: res.query,
        engine: res.engine,
        tookMs: Date.now() - started,
      });
    },
  );

  app.post(
    "/api/v1/agent/knowledge/ask",
    rateLimit,
    describeRoute({
      summary: "Deterministic answer over published knowledge — no LLM",
      tags: ["Agent Knowledge"],
      responses: {
        200: { description: "{status: ANSWERED|REFUSED, …}" },
        400: { description: "Query validation failure" },
        429: { description: "Rate limit" },
      },
    }),
    async (c) => {
      const body = askBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "query must be 2..500 chars",
        );
      }
      const answer = await composeAnswer(store, body.data.query.trim(), {
        gapRecorder: deps.gapRecorder,
      });
      return c.json(answer, 200);
    },
  );

  return app;
}
