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
 *    (D-264-Q16 — it dies here, not silently): a drop-in mount on an
 *    unmigrated mutation surface fails LOUD instead of letting the
 *    self-asserted header keep spoofing attribution until 264-6..8
 *    rewrite the call sites to getPrincipal(c).
 *  - success → c.set("principal", Principal) for audit attribution +
 *    c.set("operator", full record) for requireCapability.
 *  - lastUsedAt is a throttled (>=5min) fire-and-forget write — the
 *    diagnostics column never blocks or fails the request.
 *
 * Transport precedence differs from adminBrowserAuth deliberately:
 * X-Admin-Key > Bearer > Basic first-match — a bogus secondary
 * transport can no longer veto a valid primary credential.
 *
 * ADMIN_API_KEY gets exactly one verdict — only on a credential MISS
 * and only through the time-boxed window policy in operator-legacy
 * (SLICE-264-5): inside the window a marked break_glass principal,
 * after it a break-glass-only fallback (SLICE-264-9 retire).
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
import { tryLegacySharedKey } from "./operator-legacy";

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

// Constant-work pad for the unknown-key path: the digest compare runs
// even when the lookup missed. (Residual asymmetry is the extra
// operator fetch on a hit — lookup-then-check is inherent; the
// envelope stays byte-identical and keys are 192-bit, so the oracle
// buys nothing.)
const DUMMY_DIGEST = Buffer.alloc(32);
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function operatorAuth(store: OperatorStore) {
  return async function operatorAuthMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    // x-operator-id dies HERE (D-264-Q16) — presence is a typed 400 on
    // every verb, so an unmigrated surface can't keep attributing
    // writes to a self-asserted string.
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

    const keyHash = hashAdminKey(provided);
    let pair;
    try {
      pair = await store.getOperatorByKeyHash(keyHash);
    } catch {
      // store failure is an infrastructure 500 in the typed envelope —
      // never folded into a 401 (adminAuth misconfig precedent).
      return errorResponse(
        c,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "Operator store unavailable",
      );
    }

    const stored = pair?.credential.keyHash;
    if (pair === null || stored === undefined) {
      timingSafeEqual(Buffer.from(keyHash, "hex"), DUMMY_DIGEST);
      // SLICE-264-5 dual-auth window: no credential row → the shared
      // ADMIN_API_KEY gets exactly one more verdict — inside the
      // window it yields a MARKED break_glass principal (never a
      // personal identity); after it, only under
      // ADMIN_BREAK_GLASS_ENABLED. Refusal keeps the 401 envelope.
      const legacy = tryLegacySharedKey(provided, c.req.path);
      if (!legacy.accepted) return unauthorized(c);
      c.set("principal", legacy.principal);
      c.set("operator", legacy.operator);
      await next();
      return;
    }
    // A store that hands back a non-sha256 row is a data-integrity
    // failure — loud 500, never an uncaught RangeError on the compare.
    if (!SHA256_HEX_RE.test(stored)) {
      return errorResponse(
        c,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "Credential store returned malformed keyHash",
      );
    }
    if (
      !timingSafeEqual(
        Buffer.from(stored, "hex"),
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

    // Throttled diagnostics touch — fire-and-forget. NaN/future-dated
    // lastUsedAt counts as stale so a malformed row self-heals.
    const nowMs = Date.now();
    const lastMs =
      pair.credential.lastUsedAt === null
        ? NaN
        : Date.parse(pair.credential.lastUsedAt);
    if (
      !Number.isFinite(lastMs) ||
      lastMs > nowMs ||
      nowMs - lastMs >= LAST_USED_MIN_INTERVAL_MS
    ) {
      try {
        void store
          .touchLastUsed(pair.credential.id, new Date(nowMs).toISOString())
          .catch(() => {});
      } catch {
        // diagnostics column never fails the request — even a
        // synchronously-throwing store impl is swallowed here
      }
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
      // DISTINCT realm (adminBrowserAuth owns "admin"): browsers key
      // the Basic credential cache on (origin, realm) — during the
      // dual-auth window cached ADMIN_API_KEY and opk_ creds must not
      // transpose across old/new surfaces into 401 ping-pong.
      res.headers.set("WWW-Authenticate", 'Basic realm="operators"');
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
