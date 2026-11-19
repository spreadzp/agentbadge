/**
 * SLICE-227-3 — shared helpers for the settlement route modules.
 * `respond` maps SettlementResult error codes to HTTP statuses — the
 * code always matches the status class (EPIC-226 lesson: no
 * INTERNAL_ERROR on 4xx).
 */
import type { Context } from "hono";

import type { Database } from "@agentbadge/database";

import type {
  SettlementErrorCode,
  SettlementResult,
  VerifyPayoutTx,
} from "../../lib/settlement/index.js";

/** Injected seams — tests pass stubs; prod defaults lazily. */
export interface SettlementRouteDeps {
  getDb?: () => Database;
  /** VerifyPayoutTx adapter — wired on prod when a rail verifier exists. */
  verifyTx?: VerifyPayoutTx;
  /** Fail-closed mode for mark-paid (D-227-4). */
  requireVerification?: boolean;
}

/** Settlement domain error → HTTP status. */
const STATUS_BY_CODE: Record<SettlementErrorCode, number> = {
  OPERATOR_REQUIRED: 400,
  EVIDENCE_TOO_LARGE: 400,
  BAD_INPUT: 400,
  TX_UNVERIFIED: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  TX_REUSED: 409,
  CONFLICT: 409,
  VERIFIER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 503,
};

/** JSON response — `{...value}` on ok, `{error:{code,message}}` on fail. */
export function respond<T>(
  c: Context,
  result: SettlementResult<T>,
  okStatus = 200,
): Response {
  return result.ok
    ? c.json(result.value as Record<string, unknown>, okStatus as 200)
    : c.json(
        { error: result.error },
        STATUS_BY_CODE[result.error.code] as 400,
      );
}
