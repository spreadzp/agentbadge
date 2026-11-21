/**
 * Verify model (D-234-38-Q5): HTTP-assert always + DB cross-check for
 * dbVerify cases via X-Request-Id → event.payload.requestId (1:1).
 *
 * The traffic-log insert is fire-and-forget (traffic-log.ts:44) so a
 * missing event is `inconclusive`, NOT fail — telemetry could have
 * died silently. Poll window ~10s.
 */

import type { ExpectSpec, Verdict } from "./types";

export interface HttpObservation {
  status: number | null;         // null = fetch threw / timeout
  requestId: string | null;
  bodySnippet: string;
  /** Lowercased-name → value map of response headers (for headers asserts). */
  headers?: Record<string, string>;
  error?: string;
}

export function assertHttp(obs: HttpObservation, expect: ExpectSpec): { verdict: Verdict; note: string } {
  if (obs.status == null) {
    return { verdict: "inconclusive", note: obs.error ?? "request failed (no response)" };
  }
  const problems: string[] = [];
  if (expect.statusIn && !expect.statusIn.includes(obs.status)) {
    problems.push(`status ${obs.status} not in [${expect.statusIn.join(",")}]`);
  }
  if (expect.statusNotIn?.includes(obs.status)) {
    problems.push(`status ${obs.status} in deny-set`);
  }
  for (const bad of expect.bodyNotIncludes ?? []) {
    if (obs.bodySnippet.includes(bad)) problems.push(`body leaks "${bad}"`);
  }
  for (const [h, want] of Object.entries(expect.headers ?? {})) {
    const got = obs.headers?.[h.toLowerCase()] ?? "";
    if (!got.toLowerCase().includes(want.toLowerCase())) {
      problems.push(`header ${h} lacks "${want}" (got "${got || "—"}")`);
    }
  }
  return problems.length
    ? { verdict: "fail", note: problems.join("; ") }
    : { verdict: "pass", note: `status ${obs.status}` };
}

// ---------- dbVerify ----------

export interface EventRow {
  payload: unknown;
  createdAt?: string;
}

/** Injectable: list http_traffic events since t0 (prod impl pages events.list). */
export type EventLister = (since: string) => Promise<EventRow[]>;

function payloadField(p: unknown, k: string): string | null {
  try {
    const v = (p as Record<string, unknown> | null)?.[k];
    return typeof v === "string" ? v : v == null ? null : String(v);
  } catch {
    return null; // poisoned payload (e.g. \u0000) — treat as opaque, skip
  }
}

export function findEventByRequestId(events: EventRow[], requestId: string): EventRow | null {
  for (const e of events) {
    if (payloadField(e.payload, "requestId") === requestId) return e;
  }
  return null;
}

export interface DbCheckResult {
  found: boolean;
  recordedStatus: number | null;
  recordedPath: string | null;
  recordedUa: string | null;
  verdict: "match" | "mismatch" | "missing";
}

/** Compare one event row vs what we observed over HTTP. */
export function checkEvent(ev: EventRow | null, observedStatus: number | null): DbCheckResult {
  if (!ev) return { found: false, recordedStatus: null, recordedPath: null, recordedUa: null, verdict: "missing" };
  const st = Number(payloadField(ev.payload, "status"));
  return {
    found: true,
    recordedStatus: Number.isFinite(st) ? st : null,
    recordedPath: payloadField(ev.payload, "path"),
    recordedUa: payloadField(ev.payload, "ua"),
    verdict: observedStatus != null && Number.isFinite(st) && st === observedStatus ? "match" : "mismatch",
  };
}

/** Poll event table until our requestId lands (fire-and-forget insert).
 *  Lister-ошибки (БД недоступна, marker mismatch, proxy упал) →
 *  возвращаем null: кейс станет inconclusive, прогон не падает. */
export async function pollEvent(
  lister: EventLister, since: string, requestId: string,
  { timeoutMs = 10_000, intervalMs = 500 } = {},
): Promise<EventRow | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const events = await lister(since);
      const hit = findEventByRequestId(events, requestId);
      if (hit) return hit;
    } catch {
      return null; // БД недоступна — inconclusive, не убивать прогон
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

/** Lister, оборачивающий ошибки БД в [] (для сухих статистических вызовов). */
export async function safeList(lister: EventLister, since: string): Promise<EventRow[]> {
  try {
    return await lister(since);
  } catch {
    return [];
  }
}

/** Prod lister: pages events.list({type:'http_traffic', since}). */
export function makeProdLister(): EventLister {
  return async (since: string) => {
    const { getDatabase } = await import("../../../src/server/lib/database");
    const db = getDatabase();
    if (!db.db) return [];
    const page = await db.events.list({ type: "http_traffic", since, limit: 500 });
    return page.map(e => ({ payload: e.payload, createdAt: String(e.createdAt ?? "") }));
  };
}
