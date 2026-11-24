/**
 * EPIC-264 (SLICE-264-9): break-glass — the shared ADMIN_API_KEY is
 * an EMERGENCY credential, not a second auth path. The dual-auth
 * window (SLICE-264-5, ADMIN_LEGACY_KEY_UNTIL) is deleted: the code
 * path closed by its prod deadline, not by process.
 *
 * D-264-Q5/Q18 + C10:
 *  - A candidate that matches no credential row is compared against
 *    ADMIN_API_KEY via sha256+timingSafeEqual — one comparison
 *    implementation, formerly shared with adminAuth (now resident
 *    here after that middleware's removal).
 *  - Acceptance requires ADMIN_BREAK_GLASS_ENABLED=true. The caller
 *    gets the SYNTHETIC principal {id:"break_glass",
 *    principalType:"break_glass"} — attribution is marked, never a
 *    personal identity.
 *  - ALERT-ON-USE always: a break-glass authentication is an
 *    incident, not traffic — warn-level log (alert pipelines) +
 *    per-surface counter on EVERY accepted use.
 *  - The synthetic operator carries capabilities
 *    ["read","workflow"] — NEVER operator-admin: the shared key
 *    must not mint operator credentials (SLICE-264-4 boundary).
 *  - The credential-row shadow path stays closed upstream:
 *    issueCredential refuses keyHash === sha256(ADMIN_API_KEY)
 *    ("key_is_shared_secret"), so the shared key can only ever live
 *    on this miss path — never as a personal identity.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Counter } from "prom-client";
import { logger } from "@agentbadge/passport/logger";

import { registry } from "../metrics/metrics";
import type { AdminOperator, Principal } from "../lib/operators";

export const breakGlassAuthUsed = new Counter({
  name: "agentbadge_admin_breakglass_auth_total",
  help: "Break-glass (shared ADMIN_API_KEY) authentications — every use is an incident",
  labelNames: ["surface"],
  registers: [registry],
});

/** Timing-safe check of a candidate against ADMIN_API_KEY —
 *  hash both sides first (Audit M-13: equal-length-only compare
 *  leaks the key length via timing). */
function sharedKeyMatches(candidate: string | null | undefined): boolean {
  const apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey || !candidate) return false;
  const ha = createHash("sha256").update(candidate).digest();
  const hb = createHash("sha256").update(apiKey).digest();
  return timingSafeEqual(ha, hb);
}

/** Boot-time posture line — break-glass armed/disarmed is logged
 *  once so a "shared key works/doesn't" question answers from the
 *  boot log, not a support ticket. */
export function logBreakGlassPosture(): void {
  if (process.env.ADMIN_BREAK_GLASS_ENABLED === "true") {
    logger.warn("operators: BREAK-GLASS armed — shared key accepted", {
      configured: Boolean(process.env.ADMIN_API_KEY),
    });
  } else {
    logger.info("operators: break-glass disarmed — shared key refused");
  }
}

/** The synthetic records a break-glass use produces. principalType
 *  IS the security marker: audit rows read "break_glass", never a
 *  person. Frozen: these objects are handed to every request via
 *  c.set — a mutating consumer must not poison the shared shape. */
const BREAK_GLASS_OPERATOR: AdminOperator = Object.freeze({
  id: "break_glass",
  displayName: "break_glass",
  principalType: "break_glass",
  // no operator-admin, no probe — the shared key must never mint
  // credentials; probe surfaces want scoped service creds.
  capabilities: Object.freeze(["read", "workflow"]) as string[],
  status: "active",
  createdAt: "1970-01-01T00:00:00.000Z",
  disabledAt: null,
});

const BREAK_GLASS_PRINCIPAL: Principal = Object.freeze({
  id: "break_glass",
  principalType: "break_glass",
  keyPrefix: "break_glass",
});

export type BreakGlassAuthResult =
  | { accepted: true; principal: Principal; operator: AdminOperator }
  | { accepted: false };

/** Metric/log label for the request surface — bounded and stripped:
 *  raw decoded paths carry per-resource ids (cardinality) and can
 *  carry control bytes into the alert log line. */
const surfaceTag = (path: string): string =>
  path.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);

/**
 * Called ONLY when the candidate matched no credential row. Accepts
 * the shared key exclusively under ADMIN_BREAK_GLASS_ENABLED=true —
 * every accept alerts (warn + counter); anything else refuses.
 */
export function tryBreakGlassKey(
  candidate: string,
  surface: string,
): BreakGlassAuthResult {
  if (
    process.env.ADMIN_BREAK_GLASS_ENABLED !== "true" ||
    !sharedKeyMatches(candidate)
  ) {
    return { accepted: false };
  }
  const tag = surfaceTag(surface);
  breakGlassAuthUsed.labels(tag).inc();
  logger.warn("operator_admin.break_glass USE", { surface: tag });
  return {
    accepted: true,
    principal: BREAK_GLASS_PRINCIPAL,
    operator: BREAK_GLASS_OPERATOR,
  };
}
