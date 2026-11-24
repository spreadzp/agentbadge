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
 *  - x-operator-id is REJECTED at this boundary with a typed 400
 *    (D-264-Q16 — it dies here): a drop-in mount on an unmigrated
 *    surface fails LOUD instead of spoofing attribution until
 *    264-6..8 rewrite the call sites to getPrincipal(c).
 *  - success → c.set("principal", Principal) for audit attribution +
 *    c.set("operator", full record) for requireCapability.
 *  - lastUsedAt is a throttled (>=5min) fire-and-forget write — the
 *    diagnostics column never blocks or fails the request.
 *
 * Transport precedence: X-Admin-Key > Bearer > Basic first-match — a
 * bogus secondary can no longer veto a valid primary credential.
 *
 * ADMIN_API_KEY gets exactly one verdict — only on a credential MISS
 * and only under ADMIN_BREAK_GLASS_ENABLED (SLICE-264-9,
 * operator-breakglass.ts): a marked break_glass principal, alerted
 * on every use.
 */

import type { Context, Next } from "hono";

import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import type {
  AdminCapability,
  AdminOperator,
  OperatorStore,
  Principal,
} from "../lib/operators";
import { authenticateOperatorKey } from "./operator-verify";

/** Operator credential transport: X-Admin-Key → Bearer → Basic password. */
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
    // x-operator-id dies HERE (D-264-Q16) — presence is a typed 400,
    // so an unmigrated surface can't keep spoofing attribution.
    if (c.req.header("x-operator-id") !== undefined) {
      return errorResponse(
        c,
        400,
        ErrorCodes.OPERATOR_HEADER_REJECTED,
        "x-operator-id is not accepted — identity comes from the credential",
      );
    }

    const provided = extractOperatorKey(c);
    if (!provided) return unauthorized(c);

    // The verdict lives in operator-verify (264-8) — upgrade's
    // DID-or-admin path consumes the same logic without a mount.
    const verdict = await authenticateOperatorKey(store, provided, c.req.path);
    if (!verdict.ok) {
      return errorResponse(c, verdict.status, verdict.code, verdict.message);
    }
    c.set("principal", verdict.principal);
    c.set("operator", verdict.operator);
    await next();
  };
}

/**
 * Browser variant: browsers can't send
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
      // DISTINCT realm ("operators", not "admin") — the Basic
      // credential cache keys on (origin, realm); break-glass and
      // opk_ creds must not transpose into 401s.
      res.headers.set("WWW-Authenticate", 'Basic realm="operators"');
    }
    return res;
  };
}

/** The audit-facing actor resolved FROM the credential (D-264-Q20). */
export function getPrincipal(c: Context): Principal | undefined {
  return c.get("principal") as Principal | undefined;
}

// Actor for write-path attribution (SLICE-264-6 review): operatorAuth
// guarantees the principal on every mounted route — an UNSET one means
// the handler sits outside the auth mount (registration bug). Refuse
// up-front instead of a `getPrincipal(c)!` TypeError mid-write.
// `instanceof Response` is the refusal (requireOperatorRef shape).
export function principalId(c: Context): string | Response {
  const p = requirePrincipal(c);
  return p instanceof Response ? p : p.id;
}

/** Same contract as principalId, returning the full Principal record. */
export function requirePrincipal(c: Context): Principal | Response {
  return getPrincipal(c) ?? unauthorized(c);
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
  // SLICE-264-8 (O-264-8): the interaction admin surfaces — API +
  // SSR + mutations — are workflow-scoped wholesale; payload-bearing
  // queues are not a read-cap surface.
  { prefix: "/api/admin/interactions", capability: "workflow" },
  { prefix: "/admin/interactions", capability: "workflow" },
];

/**
 * `path` must be the DECODED route path (`c.req.path`) — a raw
 * %-encoded URL could evade the prefix and fall to the weaker
 * method fallback (under-restriction). Segment-boundary matching:
 * `/admin/operatorsX` does NOT match `/admin/operators`.
 */
export function capabilityForSurface(
  path: string,
  method: string,
): AdminCapability {
  let best: AdminCapability | undefined;
  let bestLen = -1;
  for (const row of CAPABILITY_BY_SURFACE) {
    const hit =
      path === row.prefix || path.startsWith(`${row.prefix}/`);
    if (hit && row.prefix.length > bestLen) {
      best = row.capability;
      bestLen = row.prefix.length;
    }
  }
  if (best !== undefined) return best;
  return method === "GET" || method === "HEAD" ? "read" : "workflow";
}
