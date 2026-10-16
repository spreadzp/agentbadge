/**
 * SLICE-199-12 (EPIC-199): board UI routes.
 *   GET /board             — SSR kanban (7 columns, public projection)
 *   GET /board/cards/:id   — card detail; spec visible to ops/holder
 * Same data as /api/board/cards — never exposes spec internals
 * without the same gate (canSeeSpec).
 */
import { Hono } from "hono";

import { dr, str } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { boardStore } from "../lib/board/store";
import { getBounty } from "../lib/bounties/store";
import {
  renderBoardPage,
  renderBoardCardDetail,
  BOARD_COLUMNS,
} from "../../views/board-page";
import { Layout } from "../../views/layout";
import {
  canSeeSpec,
  type AgentCtx,
} from "./board-api-helpers";

export interface BoardPageDeps {
  /** passport → reviewer-tier check (same as board-api review). */
  isReviewer?: (passportId: string) => boolean | Promise<boolean>;
}

export function createBoardPageRoutes(deps: BoardPageDeps = {}) {
  const app = new Hono<{ Variables: { agent?: AgentCtx } }>();

  app.get("/board", dr("Task board kanban"), async (c) => {
    const st = boardStore();
    await st.ready();
    const column = str(c.req.query("column"), 20);
    const q = str(c.req.query("q"), 120);
    const me = str(c.req.query("me"), 128) ?? undefined;
    const agent = c.get("agent");
    const viewer = me ?? (agent ? String(agent.agentId) : undefined);
    const reviewer = agent?.tier === "reviewer" ||
      (viewer !== undefined &&
        (await deps.isReviewer?.(viewer)) === true);

    let cards = st.listCards({ limit: 500 });
    if (column && (BOARD_COLUMNS as readonly string[]).includes(column)) {
      cards = cards.filter((cd) => cd.column === column);
    }
    if (q) {
      const needle = q.toLowerCase();
      cards = cards.filter(
        (cd) =>
          cd.title.toLowerCase().includes(needle) ||
          cd.cardId.toLowerCase().includes(needle),
      );
    }
    const attempts = new Map<string, number>();
    for (const cd of cards) {
      attempts.set(cd.cardId, getBounty(cd.bountyId)?.jobAttempt ?? 1);
    }
    const body = renderBoardPage({
      cards,
      attempts,
      me: me ?? (agent ? String(agent.agentId) : undefined),
      isReviewer: reviewer,
      filter: { column: column ?? undefined, q: q ?? undefined },
    }).toString();
    return c.html(
      Layout(
        body,
        "Task Board",
        {
          title: "Task Board",
          path: "/board",
          description: "Arc agent task board — kanban",
        },
        [],
        true,
      ),
    );
  });

  app.get("/board/cards/:id", dr("Board card detail"), async (c) => {
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
    const agent = c.get("agent");
    const body = renderBoardCardDetail({
      card,
      entries: st.listEntries(card.cardId),
      attempt: getBounty(card.bountyId)?.jobAttempt ?? 1,
      showSpec: canSeeSpec(card, agent),
    }).toString();
    return c.html(
      Layout(
        body,
        `Card ${card.cardId}`,
        {
          title: `Card ${card.cardId}`,
          path: `/board/cards/${card.cardId}`,
          description: `Board card ${card.title}`,
        },
        [],
        true,
      ),
    );
  });

  return app;
}
