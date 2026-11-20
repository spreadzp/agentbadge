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
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

/** Audit M-13: hash both sides first — equal-length-only compare
 *  leaks the key length via timing and skips timingSafeEqual for
 *  wrong-length inputs. Fixed-size digests compare cleanly. */
function safeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Timing-safe check of a candidate key against ADMIN_API_KEY. */
export function verifyAdminKey(provided: string | null | undefined): boolean {
  const apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey || !provided) return false;
  return safeCompare(provided, apiKey);
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

  // Re-audit M-13 nit: ?? picks an EMPTY X-Admin-Key over a valid
  // Bearer token — || falls through on empty strings too.
  const provided = xAdminKey || bearerKey;
  if (!provided || !safeCompare(provided, apiKey)) {
    return errorResponse(c, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
  }

  await next();
}

/**
 * EPIC-228 (O-228-3): browser wrapper for admin SSR pages.
 * Browsers can't send X-Admin-Key/Bearer spontaneously — but they
 * DO prompt natively for HTTP Basic credentials. This middleware
 * accepts `Authorization: Basic <b64(user:key)>` (username ignored,
 * password = ADMIN_API_KEY) or any credential adminAuth accepts.
 * Wrong/missing → 401 + WWW-Authenticate so the browser prompts.
 * No cookies, no session store — the key IS the session.
 */
export async function adminBrowserAuth(
  c: Context,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    let provided: string | null = null;
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString(
        "utf8",
      );
      const i = decoded.indexOf(":");
      provided = i >= 0 ? decoded.slice(i + 1) : decoded;
    } catch {
      provided = null;
    }
    if (!verifyAdminKey(provided)) {
      c.header("WWW-Authenticate", 'Basic realm="admin"');
      return errorResponse(c, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
    }
    await next();
    return;
  }
  // X-Admin-Key / Bearer — defer to the canonical middleware; on its
  // 401 add the challenge header so browsers still offer the prompt.
  const res = await adminAuth(c, next);
  if (res instanceof Response && res.status === 401) {
    res.headers.set("WWW-Authenticate", 'Basic realm="admin"');
  }
  return res;
}
