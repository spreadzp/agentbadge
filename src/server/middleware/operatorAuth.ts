/**
 * EPIC-264 (SLICE-264-2): operatorAuth — credential → Principal.
 *
 * Drop-in replacement for adminAuth (D-264-Q2): same three transports
 * (X-Admin-Key / Authorization: Bearer / Basic password), same 401
 * envelope — but the key resolves to a credential ROW instead of a
 * shared env secret. The operator record supplies the capability set
 * (C7 — never from request data); `x-operator-id` is gone entirely.
 *
 * Trust model (D-264-Q19/Q20, DoD):
 *  - sha256(candidate) → keyHash lookup → timingSafeEqual on the two
 *    digests. No early-exit on the opk_ prefix: a candidate sharing
 *    "opk_<8>" with a real credential but a different secret is a
 *    hard 401 — the compare happens on hashes only.
 *  - unknown key / revoked credential / disabled operator → the SAME
 *    401 envelope byte-for-byte; the refusal never leaks which leg
 *    failed.
 *  - success → c.set("principal", Principal) for audit attribution +
 *    c.set("operator", full record) for requireCapability.
 *  - lastUsedAt is a throttled (>=5min) fire-and-forget write — the
 *    diagnostics column never blocks or fails the request.
 *
 * ADMIN_API_KEY is deliberately NOT consulted: the shared key is the
 * dual-auth window's business (SLICE-264-5) and break-glass after
 * (SLICE-264-9).
 */

import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import {
  hashAdminKey,
  type AdminCapability,
  type AdminOperator,
  type OperatorStore,
  type Principal,
} from "../lib/operators";

/** Minimum gap between lastUsedAt writes (D-264-Q6 — diagnostics, not auth). */
const LAST_USED_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** adminAuth transport contract: X-Admin-Key → Bearer → Basic password. */
function extractOperatorKey(c: Context): string | null {
  const xAdminKey = c.req.header("X-Admin-Key");
  if (xAdminKey) return xAdminKey;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  if (authHeader?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString(
        "utf8",
      );
      const i = decoded.indexOf(":");
      const password = i >= 0 ? decoded.slice(i + 1) : decoded;
      return password || null;
    } catch {
      return null;
    }
  }
  return null;
}

function unauthorized(c: Context): Response {
  return errorResponse(c, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
}

export function operatorAuth(store: OperatorStore) {
  return async function operatorAuthMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const provided = extractOperatorKey(c);
    if (!provided) return unauthorized(c);

    const keyHash = hashAdminKey(provided);
    const pair = await store.getOperatorByKeyHash(keyHash);
    if (!pair) return unauthorized(c);

    // Digest compare — equal-length sha256 outputs, no length or
    // prefix side channel (adminAuth safeCompare precedent).
    if (
      !timingSafeEqual(
        Buffer.from(pair.credential.keyHash, "hex"),
        Buffer.from(keyHash, "hex"),
      )
    ) {
      return unauthorized(c);
    }
    // revoked credential / disabled operator — identical refusal.
    if (
      pair.credential.status !== "active" ||
      pair.operator.status !== "active"
    ) {
      return unauthorized(c);
    }

    // Throttled diagnostics touch — fire-and-forget, never awaited.
    const last = pair.credential.lastUsedAt;
    if (
      last === null ||
      Date.now() - Date.parse(last) >= LAST_USED_MIN_INTERVAL_MS
    ) {
      void store
        .touchLastUsed(pair.credential.id, new Date().toISOString())
        .catch(() => {});
    }

    const { operator, credential } = pair;
    const principal: Principal = {
      id: operator.id,
      principalType: operator.principalType,
      keyPrefix: credential.keyPrefix,
    };
    c.set("principal", principal);
    c.set("operator", operator);
    await next();
  };
}

/**
 * Browser variant (adminBrowserAuth precedent): browsers can't send
 * X-Admin-Key/Bearer spontaneously, but they DO prompt for HTTP Basic.
 * The middleware already accepts Basic — this wrapper only adds the
 * challenge header on 401 so the browser offers the prompt.
 */
export function operatorBrowserAuth(store: OperatorStore) {
  const inner = operatorAuth(store);
  return async function operatorBrowserAuthMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const res = await inner(c, next);
    if (res instanceof Response && res.status === 401) {
      res.headers.set("WWW-Authenticate", 'Basic realm="admin"');
    }
    return res;
  };
}

/** The audit-facing actor resolved FROM the credential (D-264-Q20). */
export function getPrincipal(c: Context): Principal | undefined {
  return c.get("principal") as Principal | undefined;
}

/** The full operator record (capabilities) resolved by operatorAuth. */
export function getOperator(c: Context): AdminOperator | undefined {
  return c.get("operator") as AdminOperator | undefined;
}

/**
 * Capability gate (C7): the required capability is checked against the
 * credential record only — never headers/body. Returns a typed 403
 * refusal, or null when allowed:
 *   const deny = requireCapability(c, "workflow"); if (deny) return deny;
 */
export function requireCapability(
  c: Context,
  capability: AdminCapability,
): Response | null {
  const operator = getOperator(c);
  if (!operator) return unauthorized(c); // operatorAuth not mounted
  if (!operator.capabilities.includes(capability)) {
    return errorResponse(
      c,
      403,
      ErrorCodes.INSUFFICIENT_CAPABILITY,
      `Missing capability: ${capability}`,
    );
  }
  return null;
}

/**
 * O-264-8 — surface → minimum capability, fixed in code (not request
 * data). The migration slices (264-6..8) consult this when swapping
 * adminAuth → operatorAuth mounts; entries register the exceptions,
 * the fallback classifies by verb:
 *   GET/HEAD → "read" · mutating writes → "workflow"
 * Longest prefix match wins.
 */
export const CAPABILITY_BY_SURFACE: ReadonlyArray<{
  prefix: string;
  capability: AdminCapability;
}> = [
  // operator lifecycle management (SLICE-264-3/4 own these prefixes)
  { prefix: "/admin/api/operators", capability: "operator-admin" },
  { prefix: "/admin/operators", capability: "operator-admin" },
  // probe-scoped service surfaces register here during 264-8's
  // inventory — their creds hold "probe" on the credential record.
];

export function capabilityForSurface(
  path: string,
  method: string,
): AdminCapability {
  let best: AdminCapability | undefined;
  let bestLen = -1;
  for (const row of CAPABILITY_BY_SURFACE) {
    if (path.startsWith(row.prefix) && row.prefix.length > bestLen) {
      best = row.capability;
      bestLen = row.prefix.length;
    }
  }
  if (best !== undefined) return best;
  return method === "GET" || method === "HEAD" ? "read" : "workflow";
}
