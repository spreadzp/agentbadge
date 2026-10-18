/**
 * SLICE-201-3 (EPIC-201): MCP board tools — find → terms → claim → submit →
 * receipt for external agents. Thin projections over the board store: same
 * `publicCard` shape as REST /api/board/cards (no duplicated business logic,
 * spec internals never exposed — D-201-6).
 */
import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";

import { boardStore } from "../server/lib/board/store";
import { publicCard } from "../server/routes/board-api-helpers";
import { toTaskSnapshot } from "../server/lib/board/task-model";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** POST /mcp/tools/board_list — all board cards, public projection. */
async function boardListHandler(): Promise<ToolResult> {
  const st = boardStore();
  await st.ready();
  return ok({ cards: st.listCards().map(publicCard) });
}

const boardGetArgs = {
  card_id: z.string().describe("Board card id, e.g. board_abc123"),
};

/** POST /mcp/tools/board_get — one card by id, public projection. */
async function boardGetHandler(args: {
  card_id?: string;
}): Promise<ToolResult> {
  const cardId = args.card_id ?? "";
  const st = boardStore();
  await st.ready();
  const card = st.getCard(cardId);
  if (!card) return fail(`unknown cardId: ${cardId}`);
  return ok({ card: publicCard(card) });
}

/** POST /mcp/tools/board_claim_status — who claimed it / is it open. */
async function boardClaimStatusHandler(args: {
  card_id?: string;
}): Promise<ToolResult> {
  const cardId = args.card_id ?? "";
  const st = boardStore();
  await st.ready();
  const card = st.getCard(cardId);
  if (!card) return fail(`unknown cardId: ${cardId}`);
  const snap = toTaskSnapshot(card, st.listEntries(cardId));
  return ok({
    cardId: card.cardId,
    column: card.column,
    claimable: card.column === "todo",
    executorPassportId: snap.executorPassportId,
    currentPassportId: card.currentPassportId ?? null,
    latestAttempt: snap.latestAttempt,
  });
}

export function registerBoardTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "board_list",
    "List Arc task-board cards. Same public projection as GET /api/board/cards — returns cardId, bountyId, title, column, budgetUsdc. Start here, then claim via POST /api/board/cards/:id/claim.",
    {},
    boardListHandler,
  );
  r.registerTool(
    "board_get",
    "Get one Arc task-board card by id (same as GET /api/board/cards/:id). Returns the public card projection; fetch terms via GET /api/board/cards/:id/terms before claiming.",
    boardGetArgs,
    boardGetHandler,
  );
  r.registerTool(
    "board_claim_status",
    "Check whether an Arc task-board card is still claimable: column, executorPassportId, attempt history. Call before POST /api/board/cards/:id/claim to avoid a 409.",
    boardGetArgs,
    boardClaimStatusHandler,
  );
}
