/**
 * EPIC-233 (SLICE-233-3, D-233-5): `callback_url` intake validation —
 * the shared check behind POST /api/requests and the
 * agentbadge_create_task_request tool.
 *
 * Contract: opt-in, ≤2048 chars, https only. The hostname must pass
 * the SSRF guard BOTH ways (landmine — DNS-rebind class):
 *   1. assertSafeTarget — synchronous pre-check: local-name suffixes
 *      (localhost/.internal/.lan…), IP literals (incl. v6 + decimal/
 *      octal encodings) against RFC1918/loopback/link-local/metadata.
 *   2. resolveAndPin — real DNS resolution; EVERY resolved A/AAAA
 *      must be public or the URL is refused. A hostname that resolves
 *      to nothing is unverifiable → refused too.
 * Validation runs BEFORE persist: a bad callback never reaches a row.
 */

import { assertSafeTarget } from "../../../agent-readiness/scanner/ssrf/ip-guard";
import { resolveAndPin } from "../../../agent-readiness/scanner/ssrf/dns-pin";
import { SsrfErrorCodes } from "../../../agent-readiness/scanner/ssrf/ssrf-error";

export const CALLBACK_URL_MAX = 2048;

export type CallbackUrlCheck =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "too_long"
        | "invalid_url"
        | "scheme" // not https
        | "unsafe_target" // private/reserved host or literal
        | "unresolvable"; // no public A/AAAA
    };

export async function validateCallbackUrl(
  raw: string,
): Promise<CallbackUrlCheck> {
  if (raw.length > CALLBACK_URL_MAX) return { ok: false, reason: "too_long" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "scheme" };
  try {
    assertSafeTarget(u.hostname);
  } catch {
    return { ok: false, reason: "unsafe_target" };
  }
  try {
    await resolveAndPin(u.hostname);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return {
      ok: false,
      reason:
        code === SsrfErrorCodes.SSRF_DNS_RESOLVE_FAILED
          ? "unresolvable"
          : "unsafe_target",
    };
  }
  return { ok: true, url: u.toString() };
}
