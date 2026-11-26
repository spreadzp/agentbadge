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
