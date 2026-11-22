/**
 * EPIC-230 (SLICE-230-4, D-230-4/9): public feedback routes —
 *   POST /api/v1/agent/feedback      → 202 intake (idempotent)
 *   GET  /api/v1/agent/feedback/:id  → {id,status,suggestion?} poll
 *
 * Middleware chain on POST mirrors interaction (228-3):
 * idempotency-key guard (required) → pre-DID guard → optional DID
 * signature upgrade → tiered limiter → handler. The global
 * agentKeyAuth already ran, so resolveActor only reads context.
 * GET is bearer-capability + tenant rule (tenant.ts).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { readIdempotencyKey } from "../../lib/contract-guards";
import { resolveActor } from "../../lib/agent-interaction/actor";
import {
  submitFeedback,
  getFeedbackStatus,
} from "../../lib/feedback/service";
import { feedbackIdSchema } from "../../lib/feedback/validate";
import type { FeedbackStore } from "../../lib/feedback/store";
import { limiterKey, type TieredLimiter } from "../agent-interaction/rate-limits";
import {
  createPreDidGuard,
  optionalDidSignature,
} from "../agent-interaction/agent-interaction-ingress";
import { createTieredFeedbackLimiter } from "./rate-limits";
import { readJsonBody } from "./body";
import { notFound, tenantDeny } from "./tenant";

export interface AgentFeedbackRoutesDeps {
  store: FeedbackStore;
  limiter?: TieredLimiter;
}

export function createAgentFeedbackRoutes(
  deps: AgentFeedbackRoutesDeps,
): Hono {
  const app = new Hono();
  const { store } = deps;
  const limiter = deps.limiter ?? createTieredFeedbackLimiter();

  app.post(
    "/api/v1/agent/feedback",
    describeRoute({
      summary: "Submit feedback (async, human-triaged)",
      description:
        "Structured agent feedback {text, kind?, target?, severity?}. " +
        "Idempotent via the required idempotency-key header. " +
        "Response: 202 {id,statusUrl}; a replayed key returns 200 " +
        "{id,duplicate:true}.",
      tags: ["Agent Feedback"],
      responses: {
        200: { description: "Idempotent replay — same id, duplicate:true" },
        202: { description: "Accepted for triage" },
        400: { description: "Schema violation or missing idempotency-key" },
        401: { description: "Malformed/invalid auth headers" },
        409: { description: "Key reused by a different actor" },
        422: { description: "Key reused with a different payload" },
        429: { description: "Tier rate limit exceeded" },
      },
    }),
    createPreDidGuard(),
    optionalDidSignature(),
    async (c) => {
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;

      const actor = resolveActor(c);
      if (!limiter.allow(actor.resolution, limiterKey(c, actor))) {
        return errorResponse(
          c,
          429,
          ErrorCodes.RATE_LIMITED,
          `rate limit exceeded for ${actor.resolution} tier — retry in a minute`,
          { retryable: true },
        );
      }

      const parsed = await readJsonBody(c);
      if (parsed instanceof Response) return parsed;

      const res = await submitFeedback(store, parsed, actor, {
        idempotencyKey: key,
      });
      if (!res.ok) {
        if (res.error === "actor_mismatch") {
          return errorResponse(
            c,
            409,
            ErrorCodes.INTERACTION_IDEMPOTENCY_ACTOR,
            "idempotency-key already used by a different actor",
          );
        }
        if (res.error === "payload_mismatch") {
          return errorResponse(
            c,
            422,
            ErrorCodes.INVALID_INPUT,
            "idempotency-key reused with a different payload",
          );
        }
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          res.error,
          res.field ? { hint: `field: ${res.field}` } : undefined,
        );
      }

      const statusUrl = `/api/v1/agent/feedback/${res.record.id}`;
      if (res.duplicate) {
        return c.json(
          { id: res.record.id, duplicate: true, statusUrl },
          200,
        );
      }
      c.header("Location", statusUrl);
      return c.json({ id: res.record.id, statusUrl }, 202);
    },
  );

  app.get(
    "/api/v1/agent/feedback/:id",
    describeRoute({
      summary: "Poll feedback status — public projection",
      tags: ["Agent Feedback"],
      responses: {
        200: { description: "{id,status,suggestion?,createdAt,updatedAt}" },
        404: { description: "Unknown id or other-tenant record" },
      },
    }),
    async (c) => {
      const id = feedbackIdSchema.safeParse(c.req.param("id"));
      if (!id.success) return notFound(c);
      // Arc 230-8 M6: polls are rate-limited too (unauthenticated
      // callers drove ~4 reads/req unthrottled).
      const actor = resolveActor(c);
      if (!limiter.allow(actor.resolution, limiterKey(c, actor))) {
        return errorResponse(
          c,
          429,
          ErrorCodes.RATE_LIMITED,
          `rate limit exceeded for ${actor.resolution} tier — retry in a minute`,
          { retryable: true },
        );
      }
      const rec = await store.getFeedback(id.data);
      if (!rec) return notFound(c);
      const deny = tenantDeny(c, rec);
      if (deny) return deny;
      const p = await getFeedbackStatus(store, id.data, rec);
      return c.json(p);
    },
  );

  return app;
}
