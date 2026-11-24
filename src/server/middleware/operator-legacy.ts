/**
 * EPIC-264 (SLICE-264-5): dual-auth window — the legacy shared
 * ADMIN_API_KEY rides operatorAuth for a TIME-BOXED window, marked
 * honestly, then dies to break-glass-only.
 *
 * D-264-Q5/Q18 + C10 + advisor conditions:
 *  - A candidate that matches no credential row is checked against
 *    ADMIN_API_KEY (same sha256+timingSafeEqual path as adminAuth —
 *    verifyAdminKey, not a second comparison implementation).
 *  - Window OPEN (now < ADMIN_LEGACY_KEY_UNTIL): shared key yields
 *    the SYNTHETIC principal {id:"legacy_admin",
 *    principalType:"break_glass", keyPrefix:"legacy"} — attribution
 *    is marked, never presented as a personal identity. Usage is
 *    counted per-surface (legacyAuthUsed) — the window's whole point
 *    is proving the number goes to zero.
 *  - Window CLOSED (env absent / malformed / past): shared key works
 *    ONLY under ADMIN_BREAK_GLASS_ENABLED=true — same synthetic
 *    principal, alert-on-use (warn + metric). Otherwise: same 401
 *    envelope as any bad credential.
 *  - The synthetic operator carries capabilities
 *    ["read","workflow"] — NEVER operator-admin: a shared key must
 *    not mint operator credentials even inside the window
 *    (SLICE-264-4 boundary stands).
 *  - Malformed ADMIN_LEGACY_KEY_UNTIL fails CLOSED + boot log —
 *    a typo must never silently widen the window.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Counter } from "prom-client";
import { logger } from "@agentbadge/passport/logger";

import { registry } from "../metrics/metrics";
import type {
  AdminOperator,
  Principal,
} from "../lib/operators";

/** Same digest-compare construction as adminAuth.safeCompare — fixed
 *  size inputs, no length oracle. Kept local so this file doesn't
 *  import the middleware it is the designated replacement for. */
const safeCompare = (a: string, b: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );

export const legacyAuthUsed = new Counter({
  name: "agentbadge_admin_legacy_auth_total",
  help: "Shared-key authentications accepted by the dual-auth window — must trend to zero",
  labelNames: ["surface", "mode"],
  registers: [registry],
});

export type LegacyWindow =
  | { state: "open"; until: string }
  | { state: "closed"; why: "unset" | "malformed" | "past" };

/** Fail-closed window state — an unparseable deadline is "closed",
 *  never "open forever". `now` injectable for tests. */
export function legacyWindowState(now = new Date()): LegacyWindow {
  const raw = process.env.ADMIN_LEGACY_KEY_UNTIL;
  if (raw === undefined || raw.trim() === "") {
    return { state: "closed", why: "unset" };
  }
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { state: "closed", why: "malformed" };
  return now.getTime() < t
    ? { state: "open", until: new Date(t).toISOString() }
    : { state: "closed", why: "past" };
}

/** Boot-time posture line — the window's state is logged once so a
 *  "why is the shared key still working" question answers from the
 *  boot log, not a support ticket. */
export function logLegacyWindowState(now = new Date()): void {
  const w = legacyWindowState(now);
  if (w.state === "open") {
    logger.info("operators: dual-auth window OPEN — shared key accepted until deadline", {
      until: w.until,
    });
  } else {
    logger.info("operators: dual-auth window CLOSED", {
      reason: w.why,
      breakGlassEnabled: process.env.ADMIN_BREAK_GLASS_ENABLED === "true",
    });
  }
}

/** The synthetic records the window produces. principalType IS the
 *  security marker: audit rows read "break_glass", never a person. */
const LEGACY_OPERATOR: AdminOperator = {
  id: "legacy_admin",
  displayName: "legacy_admin",
  principalType: "break_glass",
  // no operator-admin, no probe — see header: the shared key must
  // never mint credentials; probe surfaces want scoped service creds.
  capabilities: ["read", "workflow"],
  status: "active",
  createdAt: "1970-01-01T00:00:00.000Z",
  disabledAt: null,
};

const LEGACY_PRINCIPAL: Principal = {
  id: "legacy_admin",
  principalType: "break_glass",
  keyPrefix: "legacy",
};

export type LegacyAuthResult =
  | { accepted: true; principal: Principal; operator: AdminOperator }
  | { accepted: false };

/**
 * Called ONLY when the candidate matched no credential row. Returns
 * the synthetic break_glass pair when the shared key is accepted by
 * the window policy; emits the usage metric + alert on every accept.
 */
export function tryLegacySharedKey(
  candidate: string,
  surface: string,
): LegacyAuthResult {
  const apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey || !safeCompare(candidate, apiKey)) {
    return { accepted: false };
  }
  const w = legacyWindowState();
  if (w.state === "open") {
    legacyAuthUsed.labels(surface, "window").inc();
    logger.info("operator_admin.legacy_auth", {
      surface,
      mode: "window",
      until: w.until,
    });
    return {
      accepted: true,
      principal: LEGACY_PRINCIPAL,
      operator: LEGACY_OPERATOR,
    };
  }
  if (process.env.ADMIN_BREAK_GLASS_ENABLED === "true") {
    legacyAuthUsed.labels(surface, "break_glass").inc();
    // ALERT-ON-USE: post-window usage is an incident, not traffic.
    logger.warn("operator_admin.legacy_auth BREAK-GLASS", {
      surface,
      mode: "break_glass",
      windowClosedReason: w.why,
    });
    return {
      accepted: true,
      principal: LEGACY_PRINCIPAL,
      operator: LEGACY_OPERATOR,
    };
  }
  return { accepted: false };
}
