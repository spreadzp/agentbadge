/**
 * EPIC-228 (SLICE-228-2, D-228-2): session upsert.
 *
 * A session groups one agent's consecutive interactions (the A2A
 * `contextId`). Client-supplied ids are accepted after a light
 * sanitize (uuid/hex/opaque token ≤128 chars) so the requester can
 * correlate; absent or malformed → server-minted `isess_*`.
 * `lastSeenAt` + `requestCount` increment on every touch — sessions
 * carry no open/closed/TTL lifecycle (D-228-2).
 */

import { randomUUID } from "node:crypto";

import type { RequestInboxStores } from "../request-inbox/store";
import type { InteractionSessionRecord } from "../request-inbox/interaction-types";
import { SESSION_ID_MAX } from "./vocabulary";

const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;

export function sanitizeSessionId(
  raw: unknown,
): { ok: true; sessionId: string } | { ok: false } {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > SESSION_ID_MAX) {
    return { ok: false };
  }
  return SESSION_ID_RE.test(raw) ? { ok: true, sessionId: raw } : { ok: false };
}

export function mintSessionId(): string {
  return `isess_${randomUUID()}`;
}

export interface UpsertSessionResult {
  session: InteractionSessionRecord;
  sessionId: string;
  created: boolean;
  /** True when the caller's id was rejected and a fresh one minted. */
  sanitized: boolean;
}

export async function upsertSession(
  stores: RequestInboxStores,
  opts: { sessionId?: unknown; actorRef?: string | null } = {},
): Promise<UpsertSessionResult> {
  let sanitized = false;
  let sessionId: string;
  const parsed = sanitizeSessionId(opts.sessionId);
  if (parsed.ok) {
    sessionId = parsed.sessionId;
  } else {
    if (opts.sessionId !== undefined && opts.sessionId !== null) sanitized = true;
    sessionId = mintSessionId();
  }
  const { session, created } = await stores.interactions.upsertSession({
    id: sessionId,
    actorRef: opts.actorRef ?? null,
    seenAtMs: Date.now(),
  });
  return { session, sessionId, created, sanitized };
}
