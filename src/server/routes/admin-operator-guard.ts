/**
 * EPIC-229 (SLICE-229-11, H-1 fix; Arc R1 H2/M8): x-operator-id is
 * REQUIRED on mutating /admin/api/knowledge/* POSTs — audit
 * attribution is part of the contract, not an optional nicety.
 * The ref must match isOperatorRef (allowlist shape + agent-prefix
 * denylist) — self-declared inside the shared-key boundary, but no
 * longer free-text: unicode/fullwidth/zero-width/agent-shaped refs
 * get an honest 400 instead of silently passing as "operator".
 * Over-length is rejected, never truncated (an 80-char slice makes
 * two distinct ids collide in idempotency scopes + audit rows).
 * Returns the ref or a typed 400 Response (`instanceof Response`).
 */

import type { Context } from "hono";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  idempotentWrite,
  readIdempotencyKey,
  requestFingerprint,
  type IdempotentScope,
} from "../lib/contract-guards";
import {
  isOperatorRef,
  noCtrlStrict,
} from "../lib/knowledge/types";

export function requireOperatorRef(c: Context): string | Response {
  const raw = c.req.header("x-operator-id")?.trim();
  if (!raw) {
    return errorResponse(
      c,
      400,
      ErrorCodes.MISSING_FIELDS,
      "x-operator-id header required on mutations (audit attribution)",
    );
  }
  if (!isOperatorRef(raw)) {
    return errorResponse(
      c,
      400,
      ErrorCodes.INVALID_INPUT,
      "x-operator-id must be 1-80 chars of [a-z0-9._@-] and not agent-shaped",
    );
  }
  return raw.normalize("NFKC").trim();
}

/** Prod-verify fix: NUL/C0 in :id/:vid/?uri params 500s the PG driver.
 *  Arc R1 M8: single-line params also refuse \t \n \r DEL and format
 *  chars — a %0A id used to pass the loose check, write, then 500 on
 *  the redirect Location header. Returns a typed 400 when any value
 *  carries controls, else null. */
export function rejectCtrl(
  c: Context,
  ...vals: (string | undefined)[]
): Response | null {
  return vals.some((s) => s !== undefined && !noCtrlStrict(s))
    ? errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        "control characters not allowed",
      )
    : null;
}

/**
 * Arc R1 H1: the one shared write path for /admin/api/knowledge/*
 * mutations. Reads + validates the idempotency-key, binds the write
 * to a canonical body fingerprint (same key + different body →
 * honest 409 everywhere, not just on the transition route), and
 * refuses to cache failures — a stored 4xx can no longer shadow an
 * honest retry after the caller fixed state.
 */
export async function runKnowledgeWrite(
  c: Context,
  scope: string,
  produce: () => Promise<{ status: number; body: Record<string, unknown> }>,
  opts: IdempotentScope & { fingerprint?: string },
): Promise<Response> {
  const key = readIdempotencyKey(c);
  if (key instanceof Response) return key;
  try {
    const res = await idempotentWrite(scope, key, produce, {
      ...opts,
      cacheErrors: false,
    });
    return c.json(res.body, res.status as 200);
  } catch (err) {
    if (err instanceof Error && err.name === "IdempotencyConflictError") {
      return errorResponse(
        c,
        409,
        ErrorCodes.CONFLICT,
        "idempotency key reused with a different request body",
      );
    }
    throw err;
  }
}

export { requestFingerprint };
