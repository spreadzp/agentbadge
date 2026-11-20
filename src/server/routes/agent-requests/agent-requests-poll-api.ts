/**
 * EPIC-252 (SLICE-252-2): public request poll —
 *   GET /api/requests/:id → 202 (pending) | 200 {state,response} | 410 | 404
 *
 * Split out of agent-requests-api.ts for the 300-line file-size guard
 * (EPIC-228 deprecation headers pushed it over). Mounted AFTER the QA
 * corpus route so "qa" keeps winning the param slot.
 * EPIC-228: superseded by GET /api/v1/agent/requests/:id — emits
 * Deprecation/Sunset headers (D-206-8) inside the handler.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { legacyRequestInboxDeprecation } from "../../lib/contract-guards";
import type { RequestStore } from "../../lib/request-inbox/store";

const RETRY_AFTER_SEC = 5; // poll hint — how often agents should retry

export function registerRequestPollRoute(
  app: Hono,
  requests: RequestStore,
): void {
  app.get(
    "/api/requests/:id",
    describeRoute({
      summary: "Poll a request — 202 pending / 200 terminal / 410 expired",
      tags: ["Requests"],
      responses: { 200: { description: "Terminal state with response" }, 202: { description: "Still submitted/working" }, 404: { description: "Unknown request id" }, 410: { description: "Expired — must not retry" } },
    }),
    async (c) => {
      // EPIC-228: superseded by GET /api/v1/agent/requests/:id (D-206-8).
      legacyRequestInboxDeprecation(c);
      const id = c.req.param("id");
      const { record, expired } = await requests.get(id);
      if (!record) {
        return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such request",);
      }
      if (expired) {
        return errorResponse(
          c,
          410,
          ErrorCodes.REQUEST_EXPIRED,
          "request expired — do not retry",
          { retryable: false },
        );
      }
      // D-256-Q16: lifecycle visibility — poll hint stays honest
      // (ops-pull, hours–days; no SLA promised).
      const lifecycle = {
        created_at: record.createdAtMs,
        expires_at: record.expiresAtMs,
      };
      if (record.state === "submitted" || record.state === "working") {
        c.header("Retry-After", String(RETRY_AFTER_SEC));
        return c.json(
          { state: record.state, ...lifecycle, retry_after: RETRY_AFTER_SEC },
          202,
        );
      }
      return c.json(
        {
          state: record.state,
          response: record.response,
          ...lifecycle,
          retry_after: null,
        },
        200,
      );
    },
  );
}
