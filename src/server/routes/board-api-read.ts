/**
 * SLICE-199-11 (EPIC-199): board read routes — public board snapshot
 * (board:snap:{qs}, 12s tag "board"), gated card detail, and the
 * append-only journal read. Spec internals never leave the public
 * projection (Q20 parity).
 */
import { Hono } from "hono";
import type { CacheProvider } from "@agentbadge/cache";

import { dr, str } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { tryGetCache } from "../lib/cache";
import { boardStore } from "../lib/board/store";
import {
  canSeeSpec,
  publicCard,
  SNAP_TTL_SEC,
  type AgentCtx,
} from "./board-api-helpers";

export function createBoardReadRoutes(deps: { cache?: CacheProvider | null } = {}) {
  const app = new Hono<{ Variables: { agent?: AgentCtx } }>();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  app.get(
    "/api/board/cards",
    dr("Public board (no spec internals)"),
    async (c) => {
      const column = str(c.req.query("column"), 20);
      const limit = Math.min(Number(str(c.req.query("limit"), 6)) || 50, 200);
      const snapKey = `board:snap:${column ?? ""}:${limit}`;
      if (cache) {
        const hit = await cache
          .get<{ cards: unknown[] }>(snapKey)
          .catch(() => null);
        if (hit) return c.json(hit);
      }
      const st = boardStore();
      await st.ready();
      const cards = st
        .listCards(column ? { column: column as never, limit } : { limit })
        .map(publicCard);
      const body = { cards };
      await cache
        ?.set(snapKey, body, { ttlSec: SNAP_TTL_SEC, tags: ["board"] })
        .catch(() => undefined);
      return c.json(body);
    },
  );

  app.get(
    "/api/board/cards/:id/journal",
    dr("Card journal"),
    async (c) => {
      const st = boardStore();
      await st.ready();
      const card = st.getCard(c.req.param("id") ?? "");
      if (!card) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          "unknown cardId",
        );
      }
      return c.json({ entries: st.listEntries(card.cardId) });
    },
  );

  app.get(
    "/api/board/cards/:id",
    dr("Card detail (spec gated)"),
    async (c) => {
      const st = boardStore();
      await st.ready();
      const card = st.getCard(c.req.param("id") ?? "");
      if (!card) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          "unknown cardId",
        );
      }
      const view: Record<string, unknown> = {
        ...publicCard(card),
        currentPassportId: card.currentPassportId ?? null,
        fixDeadlineMs: card.fixDeadlineMs ?? null,
        specHash: card.specHash,
        entryCount: st.listEntries(card.cardId).length,
      };
      if (canSeeSpec(card, c.get("agent"))) {
        view.spec = card.spec;
      }
      return c.json({ card: view });
    },
  );

  return app;
}
