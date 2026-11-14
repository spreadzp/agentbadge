/**
 * EPIC-252 (SLICE-252-3): ops-pull channel (D-252-Q3) —
 *   GET  /api/ops/requests?state=&since=&limit=  — pull queue + payload
 *   POST /api/ops/requests/:id/respond           — response + completed
 *                                                  (working when mark_completed:false)
 *   POST /api/ops/requests/:id/state             — manual working/failed/completed
 *
 * All behind adminAuth (X-Admin-Key / Bearer). fpHash + sanitized
 * fingerprint snapshot are exposed for ops dedupe — raw IP is never
 * persisted, so nothing raw can leak here. Completed transitions go
 * through transitionWithQa → QA corpus materialization (D-252-Q7).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { adminAuth } from "../middleware/adminAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { transitionWithQa } from "../lib/request-inbox/qa";
import { sanitizeHeaders } from "../lib/request-inbox/fingerprint";
import type { RequestInboxStores } from "../lib/request-inbox/store";
import type { InboxRequestRecord } from "../lib/request-inbox/types";

const TERMINAL = new Set(["completed", "failed"]);

export interface AgentRequestOpsRoutesDeps {
  stores: RequestInboxStores;
  now?: () => number;
}

const respondSchema = z.object({
  response: z.unknown(),
  mark_completed: z.boolean().optional(),
});

const stateSchema = z.object({
  state: z.enum(["working", "failed", "completed"]),
});

const toOpsItem = (r: InboxRequestRecord) => ({
  id: r.id,
  state: r.state,
  kind: r.kind,
  payload: r.payload,
  // Re-audit C-1: re-sanitize on read — rows written before the
  // IP-carrier strip still carry raw IPs otherwise.
  fingerprint:
    r.fingerprint != null
      ? { ...r.fingerprint, headers: sanitizeHeaders(r.fingerprint.headers ?? {}) }
      : null,
  fpHash: r.fpHash,
  agentId: r.agentId,
  verified: r.verified,
  spamFlag: r.spamFlag,
  createdAtMs: r.createdAtMs,
  expiresAtMs: r.expiresAtMs,
});


export function createAgentRequestOpsRoutes(
  deps: AgentRequestOpsRoutesDeps,
): Hono {
  const app = new Hono();
  const { stores } = deps;
  const now = deps.now ?? (() => Date.now());

  app.get(
    "/api/ops/requests",
    adminAuth,
    describeRoute({
      summary: "Ops pull — list inbox requests by state/since/limit",
      tags: ["Ops"],
      responses: {
        200: { description: "Request list with payload + fingerprint" },
        401: { description: "Admin key required" },
      },
    }),
    async (c) => {
      const state = c.req.query("state");
      const sinceRaw = c.req.query("since");
      const limitRaw = c.req.query("limit");
      const sinceMs = sinceRaw ? Number(sinceRaw) : undefined;
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (
        (sinceRaw && !Number.isFinite(sinceMs)) ||
        (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) < 1))
      ) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "bad since/limit",
        );
      }
      const records = await stores.requests.listByState({
        state,
        sinceMs,
        limit: Math.min(limit ?? 100, 500),
      });
      return c.json({ items: records.map(toOpsItem) });
    },
  );

  app.post(
    "/api/ops/requests/:id/respond",
    adminAuth,
    describeRoute({
      summary: "Push an ops response — completes the request (D-252-Q3)",
      tags: ["Ops"],
      responses: {
        200: { description: "Response stored; state updated" },
        404: { description: "Unknown id" },
        409: { description: "Already terminal" },
        410: { description: "Expired" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const parsed = respondSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || parsed.data.response === undefined) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "response required",
        );
      }
      const { record, expired } = await stores.requests.get(id);
      if (!record) {
        return errorResponse(
          c,
          404,
          ErrorCodes.REQUEST_NOT_FOUND,
          "no such request",
        );
      }
      if (expired) {
        return errorResponse(
          c,
          410,
          ErrorCodes.REQUEST_EXPIRED,
          "request expired",
        );
      }
      if (TERMINAL.has(record.state)) {
        return errorResponse(c, 409, ErrorCodes.INVALID_STATE, "terminal");
      }
      const patch = {
        response: parsed.data.response,
        respondedAtMs: now(),
      };
      if (parsed.data.mark_completed === false) {
        const updated = await stores.requests.transition(
          id,
          record.state,
          "working",
          patch,
        );
        if (!updated) {
          return errorResponse(c, 409, ErrorCodes.INVALID_STATE, "terminal");
        }
        return c.json({ id, state: "working" });
      }
      const updated = await transitionWithQa(
        stores.requests,
        id,
        record.state,
        patch,
      );
      if (!updated) {
        return errorResponse(c, 409, ErrorCodes.INVALID_STATE, "terminal");
      }
      return c.json({ id, state: "completed" });
    },
  );

  app.post(
    "/api/ops/requests/:id/state",
    adminAuth,
    describeRoute({
      summary: "Manual state transition — working | failed | completed",
      tags: ["Ops"],
      responses: {
        200: { description: "Transition applied" },
        400: { description: "Invalid state" },
        404: { description: "Unknown id" },
        409: { description: "Already terminal" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const parsed = stateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "state must be working|failed|completed",
        );
      }
      const { record, expired } = await stores.requests.get(id);
      if (!record) {
        return errorResponse(
          c,
          404,
          ErrorCodes.REQUEST_NOT_FOUND,
          "no such request",
        );
      }
      if (expired) {
        return errorResponse(
          c,
          410,
          ErrorCodes.REQUEST_EXPIRED,
          "request expired",
        );
      }
      if (TERMINAL.has(record.state)) {
        return errorResponse(c, 409, ErrorCodes.INVALID_STATE, "terminal");
      }
      const target = parsed.data.state;
      const updated =
        target === "completed"
          ? await transitionWithQa(stores.requests, id, record.state, {
            respondedAtMs: now(),
          })
          : await stores.requests.transition(id, record.state, target, {
            respondedAtMs: target === "failed" ? now() : record.respondedAtMs,
          });
      if (!updated) {
        return errorResponse(c, 409, ErrorCodes.INVALID_STATE, "terminal");
      }
      return c.json({ id, state: target });
    },
  );

  app.get(
    "/api/ops/surveys/:id/answers",
    adminAuth,
    describeRoute({
      summary: "Ops pull — survey answers with voter fingerprints (hashes only)",
      tags: ["Ops"],
      responses: {
        200: { description: "Answer list for the survey" },
        401: { description: "Admin key required" },
        404: { description: "Unknown survey" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const survey = await stores.surveys.getSurvey(id);
      if (!survey) {
        return errorResponse(
          c,
          404,
          ErrorCodes.REQUEST_NOT_FOUND,
          "no survey",
        );
      }
      const answers = await stores.surveys.listAnswers(id, 500);
      return c.json({
        survey: {
          id: survey.id,
          title: survey.title,
          active: survey.active,
          closesAtMs: survey.closesAtMs,
        },
        items: answers.map((a) => ({
          id: a.id,
          agentId: a.agentId,
          fpHash: a.fpHash,
          answers: a.answers,
          rated: a.rated,
          createdAtMs: a.createdAtMs,
        })),
      });
    },
  );

  return app;
}
