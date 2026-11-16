/**
 * Commerce route helpers — extracted from shared.ts to keep it
 * under the max-lines lint bound. Re-exported via ./shared so
 * route files keep a single import surface. Owns the raw-body
 * cache keys so `readJson` and the signed-wallet gate share one
 * body read + hash.
 */
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { IdempotencyConflictError } from "../../lib/contract-guards";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes, type ErrorCode } from "../../lib/error-codes";
import { CommerceError, type CommerceErrorCode } from "../../lib/commerce";

export const RAW_BODY_KEY = "commerce.rawBody";
export const BODY_HASH_KEY = "commerce.bodyHash";

export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

/** Read the raw request body exactly once and cache it on the context. */
export async function ensureRawBody(c: Context): Promise<string> {
  const cached = c.get(RAW_BODY_KEY);
  if (typeof cached === "string") return cached;
  const raw = await c.req.raw.text();
  c.set(RAW_BODY_KEY, raw);
  c.set(BODY_HASH_KEY, raw.length ? sha256Hex(raw) : "-");
  return raw;
}

/** H4: payload is opaque per-entity private data — non-parties never see it. */
export function redactRow<T extends { payload: unknown }>(
  row: T,
  parties: readonly (string | null | undefined)[],
  viewer: string | null,
  sensitiveFields: readonly (keyof T)[] = [],
): T {
  if (viewer !== null && parties.includes(viewer)) return row;
  const redacted = { ...row, payload: null };
  for (const field of sensitiveFields) {
    (redacted as Record<string, unknown>)[field as string] = null;
  }
  return redacted;
}

export async function readJson(
  c: Context,
): Promise<Record<string, unknown> | Response> {
  try {
    const raw = await ensureRawBody(c);
    const body = JSON.parse(raw || "null") as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "JSON object body required");
    }
    return body as Record<string, unknown>;
  } catch {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
  }
}

/** CommerceError.code → canonical (status, ErrorCode) map. */
const COMMERCE_ERROR_MAP: Record<
  CommerceErrorCode,
  { status: 400 | 403 | 404 | 409; code: ErrorCode }
> = {
  NOT_FOUND: { status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND },
  FORBIDDEN: { status: 403, code: ErrorCodes.WRONG_SIGNER },
  INVALID_TRANSITION: { status: 409, code: ErrorCodes.INVALID_TRANSITION },
  GUARD_REJECTED: { status: 400, code: ErrorCodes.INVALID_INPUT },
  CONFLICT: { status: 409, code: ErrorCodes.CONFLICT },
};

/** Map CommerceError → canonical error shape; rethrows unknown errors. */
export function commerceError(c: Context, err: unknown): Response {
  if (err instanceof IdempotencyConflictError) {
    return errorResponse(c, 409, ErrorCodes.CONFLICT, err.message);
  }
  if (err instanceof CommerceError) {
    const m = COMMERCE_ERROR_MAP[err.code];
    if (m) return errorResponse(c, m.status, m.code, err.message);
  }
  throw err;
}
