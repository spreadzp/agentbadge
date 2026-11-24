/**
 * EPIC-229 (SLICE-229-11; Arc R1 H1/M8): shared write-path guards for
 * /admin/api/knowledge/* — control-char rejection and the single
 * idempotent-write wrapper.
 *
 * SLICE-264-6: attribution moved to the credential-resolved principal
 * (principalId in middleware/operatorAuth); x-operator-id is a typed
 * 400 at the operatorAuth boundary. requireOperatorRef was removed —
 * review-center + agent-interaction keep their own header handling
 * until their 264-8 migration.
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
import { noCtrlStrict } from "../lib/knowledge/types";

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
