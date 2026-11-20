/**
 * EPIC-229 (SLICE-229-11, H-1 fix): x-operator-id is REQUIRED on
 * mutating /admin/api/knowledge/* POSTs — audit attribution is
 * part of the contract, not an optional nicety. Returns the ref
 * or a typed 400 Response (use `instanceof Response` to branch).
 */

import type { Context } from "hono";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { noControlChars } from "../lib/knowledge/types";

const OPERATOR_MAX = 80;

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
  if (!noControlChars(raw)) {
    return errorResponse(
      c,
      400,
      ErrorCodes.INVALID_INPUT,
      "control characters not allowed",
    );
  }
  return raw.slice(0, OPERATOR_MAX);
}

/** Prod-verify fix: NUL/C0 in :id/:vid/?uri params 500s the PG driver.
 *  Returns a typed 400 Response when any value carries controls, else
 *  null — `const bad = rejectCtrl(c, a, b); if (bad) return bad;`. */
export function rejectCtrl(
  c: Context,
  ...vals: (string | undefined)[]
): Response | null {
  return vals.some((s) => s !== undefined && !noControlChars(s))
    ? errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        "control characters not allowed",
      )
    : null;
}
