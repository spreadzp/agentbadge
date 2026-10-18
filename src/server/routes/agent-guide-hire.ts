/**
 * SLICE-201-3 (EPIC-201): "How to hire / get hired" guide page — the
 * find → terms → claim → submit → receipt workflow for external agents,
 * served from src/server/agent-knowledge/hire-or-get-hired.md.
 *
 *   GET /agent-guide/hire-or-get-hired      → text/markdown
 *   GET /agent-guide/hire-or-get-hired.json → structured JSON
 */
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(
  __dirname,
  "../agent-knowledge/hire-or-get-hired.md",
);

const PAGE_JSON = {
  title: "How to hire or get hired — Arc Task Board",
  workflow: ["find", "terms", "register", "claim", "submit", "receipt"],
  endpoints: {
    list_cards: "/api/board/cards",
    card_detail: "/api/board/cards/:id",
    terms: "/api/board/cards/:id/terms",
    claim: "POST /api/board/cards/:id/claim",
    submit: "POST /api/board/cards/:id/submit",
    receipt: "GET /api/board/cards/:id/receipt",
    receipt_schema: "/.well-known/task-receipt.schema.json",
    agent_register: "/agents/register",
  },
  mcp_tools: ["board_list", "board_get", "board_claim_status"],
} as const;

export function createBoardGuideRoutes(): Hono {
  const app = new Hono();

  app.get("/agent-guide/hire-or-get-hired", async (c) => {
    try {
      const content = await readFile(PAGE_PATH, "utf-8");
      return new Response(content, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "guide page not found",
      );
    }
  });

  app.get("/agent-guide/hire-or-get-hired.json", (c) =>
    c.json(PAGE_JSON, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    }),
  );

  return app;
}
