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
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  KNOWLEDGE_KINDS,
  composeAnswer,
  noControlChars,
  noCtrlStrict,
  searchKnowledgeItems,
  type KnowledgeGapRecorder,
} from "../lib/knowledge";
import {
  getSharedKnowledgeSearchLimiter,
  knowledgeSearchLimiterKey,
  knowledgeSearchTier,
  SEARCH_TIER_LIMITS,
} from "../lib/knowledge/search-limits";
import type { TieredLimiter } from "./agent-interaction/rate-limits";

const Q_MIN = 2;
const Q_MAX = 200;
const LIMIT_MAX = 20;
const LIMIT_DEFAULT = 10;

function tooMany(c: Context, surface: string) {
  return errorResponse(
    c,
    429,
    ErrorCodes.RATE_LIMITED,
    `rate limit exceeded for ${surface}`,
    { retryable: true },
  );
}

const askBodySchema = z.object({
  // trim BEFORE length checks — "a " previously passed min(2) then
  // trimmed to "a" and died in the gap recorder instead of a 400.
  query: z
    .string()
    .trim()
    .min(2)
    .max(500)
    .refine(noControlChars, { message: "control characters not allowed" }),
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
  const limiter = deps.limiter ?? getSharedKnowledgeSearchLimiter();

  const rateLimit = (surface: string): MiddlewareHandler => {
    return async (c, next: Next) => {
      const tier = knowledgeSearchTier(c);
      if (!limiter.allow(tier, knowledgeSearchLimiterKey(c))) {
        // SLICE-259-19: agent-readable 429 — Retry-After + RateLimit-*
        // alongside the retryable:true body.
        const retryAfter = limiter.retryAfterSec();
        c.header("Retry-After", String(retryAfter));
        c.header("X-RateLimit-Limit", String(SEARCH_TIER_LIMITS[tier]));
        c.header("X-RateLimit-Remaining", "0");
        c.header(
          "X-RateLimit-Reset",
          String(Math.ceil((Date.now() + retryAfter * 1000) / 1000)),
        );
        return tooMany(c, surface);
      }
      return next();
    };
  };

  app.get(
    "/api/v1/agent/knowledge/search",
    rateLimit("knowledge search"),
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
      if (!noControlChars(q)) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "control characters not allowed",
        );
      }
      const kind = c.req.query("kind");
      if (kind !== undefined && !KNOWLEDGE_KINDS.includes(kind as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad kind");
      }
      const limitRaw = c.req.query("limit") ?? String(LIMIT_DEFAULT);
      // Arc R1 nit: Number() accepts "0x10"/"1e1" — digits only.
      const limit = /^\d{1,3}$/.test(limitRaw)
        ? Math.min(Math.max(parseInt(limitRaw, 10), 1), LIMIT_MAX)
        : LIMIT_DEFAULT;
      const capability = c.req.query("capability");
      if (
        capability !== undefined &&
        (capability.length > 200 || !noCtrlStrict(capability))
      ) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "control characters not allowed",
        );
      }

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
    rateLimit("knowledge ask"),
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
      const answer = await composeAnswer(store, body.data.query, {
        gapRecorder: deps.gapRecorder,
      });
      return c.json(answer, 200);
    },
  );

  return app;
}
