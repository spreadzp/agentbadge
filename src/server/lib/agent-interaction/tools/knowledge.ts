/**
 * EPIC-233 (SLICE-233-5, D-233-1): agentbadge_search_knowledge —
 * thin adapter over the SAME 229 search backend as
 * GET /api/v1/agent/knowledge/search (lib/knowledge/search.ts).
 * Reads are hard-forced to status=PUBLISHED; the rate limit rides
 * the shared REST bucket (search-limits.ts) — one budget across
 * transports.
 */

import { getDatabase } from "../../database";
import { pickKnowledgeStores } from "../../knowledge/db-stores";
import {
  getSharedKnowledgeSearchLimiter,
  knowledgeSearchLimiterKey,
  knowledgeSearchTier,
} from "../../knowledge/search-limits";
import { searchKnowledgeItems } from "../../knowledge/search";
import type { AgentToolContext, AgentToolResult } from "../registry";

const LIMIT_DEFAULT = 10;

/** agentbadge_search_knowledge ≡ GET /api/v1/agent/knowledge/search. */
export async function handleSearchKnowledge(
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const input = args as {
    query: string;
    limit?: number;
    kind?: string;
    capability?: string;
  };

  const started = Date.now();
  const limiter = getSharedKnowledgeSearchLimiter();
  const tier = knowledgeSearchTier(ctx.c);
  if (!limiter.allow(tier, knowledgeSearchLimiterKey(ctx.c))) {
    return {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `rate limit exceeded for knowledge search`,
        data: {
          retryable: true,
          retry_after_seconds: limiter.retryAfterSec(),
          http_status: 429,
        },
      },
    };
  }

  const res = await searchKnowledgeItems(
    pickKnowledgeStores(getDatabase()),
    input.query.trim(),
    {
      status: "PUBLISHED", // hard-forced — never a caller knob
      kind: input.kind ?? null,
      capabilityRef: input.capability ?? null,
      limit: input.limit ?? LIMIT_DEFAULT,
    },
  );

  return {
    ok: true,
    data: {
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
    },
  };
}
