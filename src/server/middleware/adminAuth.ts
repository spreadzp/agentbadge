/**
 * Admin API key authentication middleware.
 *
 * Reference: SLICE-1-5, SLICE-7-11, CONTEXT.md:61-63
 *
 * Accepts API key via:
 * - `X-Admin-Key` header (backward compatible)
 * - `Authorization: Bearer <key>` header (standard)
 *
 * Compares against `process.env.ADMIN_API_KEY` using timing-safe comparison.
 * Returns 401 if missing or invalid.
 */
import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function adminAuth(c: Context, next: Next): Promise<Response | void> {
  const apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey) {
    return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, "ADMIN_API_KEY not configured");
  }

  // Check X-Admin-Key header (backward compatible)
  const xAdminKey = c.req.header("X-Admin-Key");

  // Check Authorization: Bearer <key> header
  const authHeader = c.req.header("Authorization");
  const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const provided = xAdminKey ?? bearerKey;
  if (!provided || !safeCompare(provided, apiKey)) {
    return errorResponse(c, 401, ErrorCodes.INTERNAL_ERROR, "Unauthorized");
  }

  await next();
}
