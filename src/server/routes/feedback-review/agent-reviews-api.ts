/**
 * EPIC-230 (SLICE-230-4, D-230-5..9): public review routes —
 *   POST /api/v1/agent/reviews             → 202 intake (idempotent)
 *   GET  /api/v1/agent/reviews/:id         → advisory projection poll
 *   POST /api/v1/agent/reviews/:id/evidence → agent dosylka append
 *
 * Same middleware posture as the feedback route (idempotency-key
 * required on writes, optional DID upgrade, tiered limiter). Evidence
 * appends replay via the contract-guards dedupe store (24h window,
 * fingerprint-bound) — the rows themselves carry no natural key.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import {
  readIdempotencyKey,
  idempotentWrite,
  requestFingerprint,
  IdempotencyConflictError,
} from "../../lib/contract-guards";
import { resolveActor } from "../../lib/agent-interaction/actor";
import {
  submitReview,
  getReviewStatus,
} from "../../lib/reviews/service";
import { addReviewEvidence } from "../../lib/reviews/evidence";
import {
  reviewIdSchema,
  addReviewEvidenceSchema,
} from "../../lib/reviews/validate";
import type { ReviewStore } from "../../lib/reviews/store";
import { limiterKey, type TieredLimiter } from "../agent-interaction/rate-limits";
import {
  createPreDidGuard,
  optionalDidSignature,
} from "../agent-interaction/agent-interaction-ingress";
import { createTieredReviewsLimiter } from "./rate-limits";
import { readJsonBody } from "./body";
import { notFound, tenantDeny } from "./tenant";

function errorFor(
  c: Context,
  res: { error: string; field?: string },
): Response {
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
  const status: 400 | 404 | 409 | 422 =
    res.error === "not_found"
      ? 404
      : res.error === "not_editable_in_status" || res.error === "status_mismatch"
        ? 409
        : res.error === "evidence_cap"
          ? 422
          : 400;
  return errorResponse(
    c,
    status,
    res.error === "not_found"
      ? ErrorCodes.REQUEST_NOT_FOUND
      : ErrorCodes.INVALID_INPUT,
    res.error,
    res.field ? { hint: `field: ${res.field}` } : undefined,
  );
}

export interface AgentReviewsRoutesDeps {
  store: ReviewStore;
  limiter?: TieredLimiter;
}

export function createAgentReviewsRoutes(
  deps: AgentReviewsRoutesDeps,
): Hono {
  const app = new Hono();
  const { store } = deps;
  const limiter = deps.limiter ?? createTieredReviewsLimiter();

  const charge = (c: Context): Response | null => {
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
    return null;
  };

  app.post(
    "/api/v1/agent/reviews",
    describeRoute({
      summary: "Request a human review (advisory, poll for decision)",
      description:
        "Structured review request {reviewType, workRef, agentCriteria?[], " +
        "evidence?[]}. Review is ADVISORY human work — not an EaaS verdict, " +
        "attestation or trust artifact. Idempotent via the required " +
        "idempotency-key header.",
      tags: ["Agent Reviews"],
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
      const limited = charge(c);
      if (limited) return limited;
      const parsed = await readJsonBody(c);
      if (parsed instanceof Response) return parsed;

      const res = await submitReview(store, parsed, resolveActor(c), {
        idempotencyKey: key,
      });
      if (!res.ok) return errorFor(c, res);

      const statusUrl = `/api/v1/agent/reviews/${res.record.id}`;
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
    "/api/v1/agent/reviews/:id",
    describeRoute({
      summary: "Poll a review — advisory public projection",
      tags: ["Agent Reviews"],
      responses: {
        200: {
          description:
            "{id,reviewType,status,submittedAt,decidedAt?,decision?{outcome," +
            "summary,criteriaResults,binding:ADVISORY_HUMAN,decidedBy:OPERATOR}}",
        },
        404: { description: "Unknown id or other-tenant record" },
      },
    }),
    async (c) => {
      const id = reviewIdSchema.safeParse(c.req.param("id"));
      if (!id.success) return notFound(c);
      // Arc 230-8 M6: polls are rate-limited too.
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
      const rec = await store.getReview(id.data);
      if (!rec) return notFound(c);
      const deny = tenantDeny(c, rec);
      if (deny) return deny;
      return c.json(await getReviewStatus(store, id.data, rec));
    },
  );

  app.post(
    "/api/v1/agent/reviews/:id/evidence",
    describeRoute({
      summary: "Append agent evidence to a pending review",
      description:
        "AGENT-side evidence dosylka — allowed only while the case is " +
        "PENDING_TRIAGE; the ≤50 cap applies across all rows. Idempotent " +
        "via the required idempotency-key header (24h replay window).",
      tags: ["Agent Reviews"],
      responses: {
        200: { description: "{added, ids[]} — replay marked duplicate:true" },
        400: { description: "Schema violation or missing idempotency-key" },
        404: { description: "Unknown review id" },
        409: { description: "Case no longer accepts agent evidence" },
        422: { description: "Evidence cap exceeded" },
        429: { description: "Tier rate limit exceeded" },
      },
    }),
    createPreDidGuard(),
    optionalDidSignature(),
    async (c) => {
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const id = reviewIdSchema.safeParse(c.req.param("id"));
      if (!id.success) return notFound(c);
      const limited = charge(c);
      if (limited) return limited;
      const parsed = await readJsonBody(c);
      if (parsed instanceof Response) return parsed;
      const body = addReviewEvidenceSchema.safeParse(parsed);
      if (!body.success) {
        const issue = body.error.issues[0];
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          issue?.message ?? "invalid evidence body",
          { hint: `field: ${issue?.path.join(".") ?? "evidence"}` },
        );
      }

      // Tenant rule on mutation too: an identified actor can only
      // append to their own case (AGENT rows inherit submitter side).
      const rec = await store.getReview(id.data);
      if (!rec) return notFound(c);
      const deny = tenantDeny(c, rec);
      if (deny) return deny;

      const actor = resolveActor(c);
      try {
        const out = await idempotentWrite(
          "POST:/api/v1/agent/reviews/evidence",
          key,
          async () => {
            const res = await addReviewEvidence(
              store,
              id.data,
              body.data.evidence,
              "AGENT",
            );
            if (!res.ok) {
              return { status: 422, body: { error: res.error } };
            }
            return {
              status: 200,
              body: { added: res.added.length, ids: res.added.map((e) => e.id) },
            };
          },
          {
            owner: actor.actorRef ?? `anon:${id.data}`,
            resource: id.data,
            fingerprint: requestFingerprint(body.data),
            cacheErrors: false,
          },
        );
        if (out.status !== 200) {
          const err = (out.body as { error?: string }).error ?? "invalid";
          return errorFor(c, { error: err });
        }
        // Past the guard out.status === 200 — store errors came back
        // as ≥400 markers that errorFor re-mapped above (and
        // cacheErrors:false keeps them out of the replay window).
        return c.json({ ...out.body, duplicate: out.duplicate }, 200);
      } catch (err) {
        if (err instanceof IdempotencyConflictError) {
          return errorResponse(
            c,
            422,
            ErrorCodes.INVALID_INPUT,
            "idempotency-key reused with a different payload",
          );
        }
        throw err;
      }
    },
  );

  return app;
}
