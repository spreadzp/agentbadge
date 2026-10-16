/**
 * SLICE-199-13 (EPIC-199): QA verdict route — the ops/QA worker
 * entry that lands evaluator outcomes on the board (testing →
 * review on pass, testing → bug on fail via enterBugCard).
 */
import { Hono } from "hono";
import type { CacheProvider } from "@agentbadge/cache";

import { dr, str } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { tryGetCache } from "../lib/cache";
import { recordBoardQaVerdict } from "../lib/board/qa";
import {
  boardRateLimited,
  denyPassport,
  denyRate,
  denyTier,
  type AgentCtx,
} from "./board-api-helpers";

export function createBoardQaRoutes(deps: {
  cache?: CacheProvider | null;
  now?: () => number;
} = {}) {
  const app = new Hono<{ Variables: { agent?: AgentCtx } }>();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  app.post(
    "/api/board/cards/:id/qa",
    dr("QA verdict (ops)"),
    async (c) => {
      const agent = c.get("agent");
      if (!agent?.agentId) return denyPassport(c);
      if (agent.tier !== "ops") return denyTier(c, "qa verdict");
      const passportId = String(agent.agentId);
      if (await boardRateLimited(cache, passportId)) return denyRate(c);
      const body = (await c.req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const verdict = str(body?.verdict, 10);
      if (verdict !== "pass" && verdict !== "fail") {
        return errorResponse(
          c,
          400,
          ErrorCodes.MISSING_FIELDS,
          "body must contain verdict pass|fail, optional reasonCodes[]",
        );
      }
      const result = await recordBoardQaVerdict(
        {
          cardId: c.req.param("id") ?? "",
          verdict,
          reasonCodes: Array.isArray(body?.reasonCodes)
            ? body.reasonCodes
              .map((x) => str(x, 60))
              .filter((x): x is string => !!x)
            : undefined,
          actor: String(agent.agentId),
        },
        deps,
      );
      if (!result.ok) {
        return errorResponse(
          c,
          result.status as 404 | 409,
          result.code,
          result.message,
        );
      }
      await cache?.invalidateTag("board").catch(() => 0);
      return c.json({ card: result.card });
    },
  );

  return app;
}
