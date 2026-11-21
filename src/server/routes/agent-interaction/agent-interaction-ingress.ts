/**
 * EPIC-228 (SLICE-228-3): ingress middleware for the interaction
 * POST chain — extracted from agent-interaction-api.ts for the
 * 300-line cap. Mount order (see the route file):
 * ingressScan (no-op seam → EPIC-187) → idempotency-key guard →
 * pre-DID guard (H3: IP bucket + body cap BEFORE signature work) →
 * optionalDidSignature → tiered limiter → handler.
 */

import type { Context, MiddlewareHandler, Next } from "hono";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { requireDidSignature } from "../../middleware/did-auth";
import { resolveClientIp } from "../../middleware/rate-limit";
import { readBodyCap } from "../../lib/request-inbox/intake";
import { INTERACTION_PAYLOAD_MAX } from "../../lib/agent-interaction";
import { createFixedLimiter } from "./rate-limits";

/** EPIC-187 seam — payload scan/policies land here later. No-op by
 *  design so the mount order is already correct when it lands. */
export function ingressScan(): MiddlewareHandler {
  return async (_c: Context, next: Next) => next();
}

/**
 * Optional DID upgrade: all four auth headers present → full
 * verification (a bad signature is a 401, never silent anon);
 * none present → anonymous passthrough; partial → 401 malformed.
 */
export function optionalDidSignature(): MiddlewareHandler {
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

/**
 * Pre-auth guard for the DID path: a cheap per-IP bucket + the body
 * cap BEFORE `optionalDidSignature` does its unbounded work (buffer,
 * SHA-256, DID resolution, nonce write). Re-injects the capped bytes
 * as `c.req.text` so the signature hash stays identical.
 * Evaluated once at route registration — the limiter state persists.
 */
export function createPreDidGuard(): MiddlewareHandler {
  const preAuth = createFixedLimiter(20); // auth attempts per IP per min
  return async (c, next) => {
    if (!c.req.header("X-AgentBadge-Did")) return next();
    if (!preAuth.allow(`ip:${resolveClientIp(c)}`)) {
      return errorResponse(
        c,
        429,
        ErrorCodes.RATE_LIMITED,
        "too many DID auth attempts — retry in a minute",
        { retryable: true },
      );
    }
    const raw = await readBodyCap(c, INTERACTION_PAYLOAD_MAX);
    if (raw === null) {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        `body exceeds ${INTERACTION_PAYLOAD_MAX} bytes`,
      );
    }
    c.req.text = (async () => raw) as typeof c.req.text;
    return next();
  };
}
