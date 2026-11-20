/**
 * EPIC-229 (SLICE-229-11, H-1 fix): x-operator-id is REQUIRED on
 * mutating /admin/api/knowledge/* POSTs — audit attribution is
 * part of the contract, not an optional nicety. Returns the ref
 * or a typed 400 Response (use `instanceof Response` to branch).
 */

import type { Context } from "hono";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";

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
  return raw.slice(0, OPERATOR_MAX);
}
