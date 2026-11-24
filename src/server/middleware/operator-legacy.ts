/**
 * EPIC-264 (SLICE-264-5): dual-auth window — the legacy shared
 * ADMIN_API_KEY rides operatorAuth for a TIME-BOXED window, marked
 * honestly, then dies to break-glass-only.
 *
 * D-264-Q5/Q18 + C10 + advisor conditions:
 *  - A candidate that matches no credential row is checked against
 *    ADMIN_API_KEY via the SAME code path as adminAuth —
 *    verifyAdminKey (sha256+timingSafeEqual), not a second
 *    comparison implementation.
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
 *  - Malformed ADMIN_LEGACY_KEY_UNTIL fails CLOSED — including the
 *    OFFSET-LESS ISO trap ("2026-12-15T00:00:00" parses as
 *    SERVER-LOCAL time, silently widening the window on negative-TZ
 *    hosts). The deadline must carry an explicit zone designator
 *    (Z or ±HH:MM) — ambiguity is closed, never local.
 *  - The credential-row shadow path is closed upstream:
 *    issueCredential refuses keyHash === sha256(ADMIN_API_KEY)
 *    ("key_is_shared_secret"), so the shared key can only ever live
 *    on this miss path — never as a personal identity.
 */

import { Counter } from "prom-client";
import { logger } from "@agentbadge/passport/logger";

import { registry } from "../metrics/metrics";
import { verifyAdminKey } from "./adminAuth";
import type {
  AdminOperator,
  Principal,
} from "../lib/operators";

export const legacyAuthUsed = new Counter({
  name: "agentbadge_admin_legacy_auth_total",
  help: "Shared-key authentications accepted by the dual-auth window — must trend to zero",
  labelNames: ["surface", "mode"],
  registers: [registry],
});

export type LegacyWindow =
  | { state: "open"; until: string }
  | { state: "closed"; why: "unset" | "malformed" | "past" };

/** An ISO timestamp is acceptable ONLY with an explicit zone
 *  designator — Z or ±HH:MM. "2026-12-15T00:00:00" would parse as
 *  server-local: a fail-OPEN on any host west of Greenwich. */
const EXPLICIT_ZONE_RE = /(?:Z|[+-]\d{2}:\d{2})$/;

/** Fail-closed window state — an unparseable OR zone-ambiguous
 *  deadline is "closed", never "open forever". `now` injectable
 *  for tests. */
export function legacyWindowState(now = new Date()): LegacyWindow {
  const raw = process.env.ADMIN_LEGACY_KEY_UNTIL;
  if (raw === undefined || raw.trim() === "") {
    return { state: "closed", why: "unset" };
  }
  const trimmed = raw.trim();
  const t = Date.parse(trimmed);
  if (!Number.isFinite(t) || !EXPLICIT_ZONE_RE.test(trimmed)) {
    return { state: "closed", why: "malformed" };
  }
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
 *  security marker: audit rows read "break_glass", never a person.
 *  Frozen: these objects are handed to every request via c.set —
 *  a future mutating consumer must not poison the shared shape. */
const LEGACY_OPERATOR: AdminOperator = Object.freeze({
  id: "legacy_admin",
  displayName: "legacy_admin",
  principalType: "break_glass",
  // no operator-admin, no probe — see header: the shared key must
  // never mint credentials; probe surfaces want scoped service creds.
  capabilities: Object.freeze(["read", "workflow"]) as string[],
  status: "active",
  createdAt: "1970-01-01T00:00:00.000Z",
  disabledAt: null,
});

const LEGACY_PRINCIPAL: Principal = Object.freeze({
  id: "legacy_admin",
  principalType: "break_glass",
  keyPrefix: "legacy",
});

export type LegacyAuthResult =
  | { accepted: true; principal: Principal; operator: AdminOperator }
  | { accepted: false };

/** Metric/log label for the request surface — bounded and stripped:
 *  raw decoded paths carry per-resource ids (cardinality) and can
 *  carry control bytes into the alert log line. */
const surfaceTag = (path: string): string =>
  path.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);

/**
 * Called ONLY when the candidate matched no credential row. Returns
 * the synthetic break_glass pair when the shared key is accepted by
 * the window policy; emits the usage metric + alert on every accept.
 */
export function tryLegacySharedKey(
  candidate: string,
  surface: string,
): LegacyAuthResult {
  if (!verifyAdminKey(candidate)) {
    return { accepted: false };
  }
  const tag = surfaceTag(surface);
  const w = legacyWindowState();
  if (w.state === "open") {
    legacyAuthUsed.labels(tag, "window").inc();
    logger.info("operator_admin.legacy_auth", {
      surface: tag,
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
    legacyAuthUsed.labels(tag, "break_glass").inc();
    // ALERT-ON-USE: post-window usage is an incident, not traffic.
    logger.warn("operator_admin.legacy_auth BREAK-GLASS", {
      surface: tag,
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
