/**
 * EPIC-228 (SLICE-228-3, D-228-1/3/7/8): public interaction routes —
 *   POST /api/v1/agent/interaction        → 202 intake (idempotent)
 *   GET  /api/v1/agent/requests/:id        → public projection (poll)
 *   GET  /api/v1/agent/requests/:id/status → {status} cheap poll
 *
 * Middleware chain on POST: ingressScan (no-op seam → EPIC-187) →
 * idempotency-key contract guard (D-206-5, required) → optional DID
 * signature upgrade → tiered limiter (O-228-1) → handler. The global
 * agentKeyAuth already ran (index.ts), so resolveActor only reads
 * context. GET is bearer-capability: an identified actor whose ref
 * doesn't match the record's gets a 404 (tenant isolation), an anon
 * caller reads via the unguessable uuid.
 */

import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { readIdempotencyKey } from "../../lib/contract-guards";
import { requireDidSignature } from "../../middleware/did-auth";
import { buildFingerprint } from "../../lib/request-inbox/fingerprint";
import {
  hasJsonbUnsafe,
  headerSnapshot,
  readBodyCap,
} from "../../lib/request-inbox/intake";
import { resolveClientIp } from "../../middleware/rate-limit";
import type { RequestInboxStores } from "../../lib/request-inbox/store";
import { statusOfState } from "../../lib/request-inbox/interaction-types";
import type { RequestInboxEnvConfig } from "../../../config/env/types";
import {
  createRequest,
  INTERACTION_ATTACHMENTS_MAX,
  INTERACTION_KINDS,
  INTERACTION_PAYLOAD_MAX,
  INTERACTION_TEXT_MAX,
  mintSessionId,
  resolveActor,
  sanitizeChannel,
  sanitizeSessionId,
} from "../../lib/agent-interaction";
import { registerInteractionGetRoutes } from "./agent-interaction-gets";
import {
  createTieredInteractionLimiter,
  limiterKey,
  type TieredLimiter,
} from "./rate-limits";

/** EPIC-187 seam — payload scan/policies land here later. No-op by
 *  design so the mount order is already correct when it lands. */
function ingressScan(): MiddlewareHandler {
  return async (_c: Context, next: Next) => next();
}

/**
 * Optional DID upgrade: all four auth headers present → full
 * verification (a bad signature is a 401, never silent anon);
 * none present → anonymous passthrough; partial → 401 malformed.
 */
function optionalDidSignature(): MiddlewareHandler {
  const verify = requireDidSignature();
  return async (c, next) => {
    const headers = [
      c.req.header("X-AgentBadge-Signature"),
      c.req.header("X-AgentBadge-Timestamp"),
      c.req.header("X-AgentBadge-Nonce"),
      c.req.header("X-AgentBadge-Did"),
    ];
    const present = headers.filter(Boolean).length;
    if (present === 0) return next();
    if (present < 4) {
      return errorResponse(
        c,
        401,
        ErrorCodes.MISSING_FIELDS,
        "incomplete DID auth headers — send all four X-AgentBadge-* headers or none",
      );
    }
    return verify(c, next);
  };
}

const postBodySchema = z.object({
  type: z.enum(INTERACTION_KINDS).optional(),
  text: z.string().min(1).max(INTERACTION_TEXT_MAX),
  context: z
    .object({
      sessionId: z.string().max(128).optional(),
      channel: z.string().max(64).optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  attachments: z
    .array(z.string().max(512))
    .max(INTERACTION_ATTACHMENTS_MAX)
    .optional(),
});

/** Body may already be buffered (did-auth reads it for hashing). */
async function readInteractionBody(c: Context): Promise<string | null> {
  if (c.req.raw.bodyUsed) {
    const t = await c.req.text();
    return Buffer.byteLength(t, "utf8") > INTERACTION_PAYLOAD_MAX ? null : t;
  }
  return readBodyCap(c, INTERACTION_PAYLOAD_MAX);
}

export interface AgentInteractionRoutesDeps {
  stores: RequestInboxStores;
  env: RequestInboxEnvConfig;
  now?: () => number;
  limiter?: TieredLimiter;
}

export function createAgentInteractionRoutes(
  deps: AgentInteractionRoutesDeps,
): Hono {
  if ((deps.env.fingerprintSalt ?? "").length < 8) {
    throw new Error("fingerprintSalt must be >= 8 chars");
  }
  const app = new Hono();
  const { stores, env } = deps;
  const now = deps.now ?? (() => Date.now());
  const limiter = deps.limiter ?? createTieredInteractionLimiter({ now });

  // Public GETs live in agent-interaction-gets.ts (file-size guard).
  registerInteractionGetRoutes(app, stores);

  // ── POST intake ──

  app.post(
    "/api/v1/agent/interaction",
    ingressScan(),
    describeRoute({
      summary: "Submit an agent interaction request (async, human-answered)",
      description:
        "Universal entry for agent→human interactions. Idempotent via " +
        "the idempotency-key header. Response: 202 {requestId,status,statusUrl,sessionId}; " +
        "a replayed key returns 200 {requestId,duplicate:true}.",
      tags: ["Agent Interaction"],
      responses: {
        200: { description: "Idempotent replay — same requestId, duplicate:true" },
        202: { description: "Accepted for review" },
        400: { description: "Schema/caps violation or missing idempotency-key" },
        401: { description: "Malformed/invalid auth headers" },
        429: { description: "Tier rate limit exceeded" },
      },
    }),
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

      const raw = await readInteractionBody(c);
      if (raw === null) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `body exceeds ${INTERACTION_PAYLOAD_MAX} bytes`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw || "null");
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
      }
      const body = postBodySchema.safeParse(parsed);
      if (!body.success) {
        const hint = body.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "body must be {type?, text≤16KB, context?{sessionId?,channel?,meta?}, attachments?≤20}",
          { hint },
        );
      }
      if (hasJsonbUnsafe(parsed)) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "payload contains characters unsafe for storage",
        );
      }

      // Session id resolve only — the touch (requestCount++) happens
      // inside submitInteraction's transaction so a duplicate replay
      // can't inflate the count.
      const sid = sanitizeSessionId(body.data.context?.sessionId);
      const sessionId = sid.ok ? sid.sessionId : mintSessionId();
      const { fpHash, fingerprint } = buildFingerprint({
        ip: resolveClientIp(c),
        ua: c.req.header("user-agent"),
        referer: c.req.header("referer"),
        src: c.req.header("x-src"),
        headers: headerSnapshot(c),
        salt: env.fingerprintSalt,
      });

      const res = await createRequest(stores, {
        payload: parsed,
        kind: body.data.type ?? null,
        actor,
        sessionId,
        channel: sanitizeChannel(body.data.context?.channel),
        fingerprint,
        fpHash,
        idempotencyKey: key,
        expiresAtMs: now() + env.requestTtlMs,
      });
      if (!res.ok) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          res.error === "payload_too_large"
            ? `payload exceeds ${INTERACTION_PAYLOAD_MAX} bytes`
            : `unknown type — allowed: ${INTERACTION_KINDS.join(", ")}`,
        );
      }

      const statusUrl = `/api/v1/agent/requests/${res.record.id}`;
      if (res.duplicate) {
        return c.json(
          {
            requestId: res.record.id,
            duplicate: true,
            status: statusOfState(res.record.state),
            statusUrl,
            sessionId,
          },
          200,
        );
      }
      c.header("Location", statusUrl);
      return c.json(
        {
          requestId: res.record.id,
          status: "PENDING_REVIEW",
          statusUrl,
          sessionId,
        },
        202,
      );
    },
  );

  return app;
}
