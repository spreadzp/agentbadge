/**
 * EPIC-233 (SLICE-233-2): shared request-poll outcome — extracted from
 * routes/agent-requests/agent-requests-poll-api.ts so the REST route
 * and the agentbadge_get_request_status MCP tool run the SAME code
 * path (thin-adapter rule: domain logic lives in lib/, surfaces map
 * it to their transport).
 *
 * Semantics (D-233-4 passthrough): submitted|working → pending;
 * completed|failed → terminal; expired → expired (410-equiv); unknown
 * or foreign-owned id → not_found (404-equiv).
 */

import type { RequestStore } from "./store";
import { REQUEST_ID_RE, type InboxRequestRecord } from "./types";

/** Arc-audit M13 (233-10): the public response channel strips keys
 *  that are unambiguously internal (identity/fingerprint/webhook
 *  internals or `_`-prefixed) before leaving through poll/webhook —
 *  the operator response shape is free-form, so a strict allowlist
 *  would break legitimate payloads; this bounds the leak surface to
 *  declared-internal names. */
const INTERNAL_RESPONSE_KEYS = new Set([
  "fingerprint",
  "fpHash",
  "softFpHash",
  "ipFpHash",
  "agentId",
  "actorRef",
  "actorResolution",
  "ip",
  "callbackUrl",
  "webhookSecret",
  "internal",
]);

export function publicResponseFor(response: unknown): unknown {
  const proj = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(proj);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith("_") || INTERNAL_RESPONSE_KEYS.has(k)) continue;
      out[k] = proj(val);
    }
    return out;
  };
  return proj(response);
}

export type RequestPollOutcome =
  | { kind: "pending"; record: InboxRequestRecord }
  | { kind: "terminal"; record: InboxRequestRecord }
  | { kind: "expired" }
  | { kind: "not_found" };

/** Arc-audit R2-H2 identity gate — SHARED rule, never re-implemented
 *  per surface: the row is a shared agentRequest row, so a capability-URL
 *  read must not become a side door around the v1 identity gate.
 *  API_KEY-owned rows require the owning key; identified callers can't
 *  read foreign identified rows; DID/ANON stay capability-URL. */
export function requestVisibleTo(
  record: InboxRequestRecord,
  callerRef: string | null,
): boolean {
  return !(
    (record.actorResolution === "API_KEY" &&
      callerRef !== record.actorRef) ||
    (callerRef !== null &&
      record.actorRef !== null &&
      callerRef !== record.actorRef)
  );
}

export async function requestPoll(
  requests: RequestStore,
  id: string,
  callerRef: string | null,
): Promise<RequestPollOutcome> {
  if (!REQUEST_ID_RE.test(id)) return { kind: "not_found" };
  const { record, expired } = await requests.get(id);
  if (!record || !requestVisibleTo(record, callerRef)) {
    return { kind: "not_found" };
  }
  if (expired) return { kind: "expired" };
  if (record.state === "submitted" || record.state === "working") {
    return { kind: "pending", record };
  }
  return { kind: "terminal", record };
}
