/**
 * EPIC-256 (SLICE-256-3, D-256-Q14): public QA corpus search —
 *   GET /api/requests/qa?q=  → matching pairs with public provenance
 *
 * Split out of agent-requests-api.ts for the 300-line file-size guard.
 * The response carries `qa_id` (public corpus id), `published_at` and
 * `provenance` — `sourceRequestId` is a bearer capability id and is
 * NEVER returned here.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { searchPublicQa } from "../../lib/request-inbox/qa";
import type { RequestStore } from "../../lib/request-inbox/store";

/** Registers `GET /api/requests/qa` on the given app — mount BEFORE
 *  any `/:id` route so "qa" wins the param slot. */
export function registerQaSearchRoute(
  app: Hono,
  requests: RequestStore,
): void {
  app.get(
    "/api/requests/qa",
    describeRoute({
      summary: "Search the request-inbox QA corpus (D-252-Q7, D-256-Q14)",
      tags: ["Requests"],
      responses: { 200: { description: "Matching QA pairs" } },
    }),
    async (c) => {
      const q = c.req.query("q")?.trim();
      if (!q) {
        // SLICE-259-19: bare-400 was the top agent error — attach the
        // exact call shape so a machine client can self-correct.
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "q required", {
          hint: "example: GET /api/requests/qa?q=how+do+I+verify+a+verdict",
        });
      }
      // EPIC-233: shared code path with agentbadge_ask (MCP tool).
      return c.json({ results: await searchPublicQa(requests, q, 25) });
    },
  );
}
