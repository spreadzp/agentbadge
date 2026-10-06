import type { Context } from "hono";
import type { ErrorCode } from "./error-codes";
import { REFUSAL_CODES } from "./refusal-contract";

interface ErrorBody {
  error: string;
  code: ErrorCode;
  retryable?: boolean;
  hint?: string;
  charged?: boolean;
  refund?: RefundNotice;
}

export interface RefundNotice {
  status: "pending" | "sent" | "failed";
  /** Refund transaction hash when an auto-refund was broadcast. */
  tx?: string;
}

export function errorResponse(
  c: Context,
  status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500,
  code: ErrorCode,
  error: string,
  opts?: { retryable?: boolean; hint?: string },
): Response {
  const body: ErrorBody = { error, code };
  if (opts?.retryable !== undefined) body.retryable = opts.retryable;
  if (opts?.hint) body.hint = opts.hint;
  return c.json(body, status);
}

/**
 * EPIC-181 refusal response: "refusal ≠ charged".
 *
 * HTTP status is derived from REFUSAL_MATRIX (single source — refusal codes
 * cannot silently drift from the published contract). Body always carries
 * `charged: false`; `refund` is attached for self-settle rails where the
 * payment tx already landed on-chain (see lib/refund-log.ts, SLICE-181-2).
 */
export function refuse(
  c: Context,
  code: Extract<ErrorCode, "policy_refusal" | "insufficient_subject" | "execution_failed" | "data_unavailable">,
  error: string,
  opts?: { hint?: string; refund?: RefundNotice },
): Response {
  const entry = REFUSAL_CODES.get(code);
  const status = (entry?.http ?? 500) as 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
  const body: ErrorBody = { error, code, charged: false };
  if (opts?.hint) body.hint = opts.hint;
  if (opts?.refund) body.refund = opts.refund;
  return c.json(body, status);
}
