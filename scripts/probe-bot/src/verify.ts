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
  /** Parsed JSON body (undefined when body isn't JSON). */
  bodyJson?: unknown;
  error?: string;
}

/** dot-path getter: "a.b.c", "$.a.b", "a[0].b" → value | undefined. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.replace(/^\$\.?/, "").split(".")) {
    if (cur == null) return undefined;
    const m = seg.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!m) return undefined;
    cur = (cur as Record<string, unknown>)[m[1]];
    if (m[2] != null) cur = (cur as unknown[])?.[Number(m[2])];
  }
  return cur;
}

const JSON_TYPE: Record<string, (v: unknown) => boolean> = {
  string: v => typeof v === "string",
  number: v => typeof v === "number",
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === "boolean",
  object: v => v != null && typeof v === "object" && !Array.isArray(v),
  array: v => Array.isArray(v),
};

/** Resolved-openapi-lite check: required fields + shallow prop types. */
export function checkSchemaLite(
  body: unknown,
  schema: { required?: string[]; props?: Record<string, string> },
): string[] {
  const problems: string[] = [];
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return ["body is not a JSON object (schema check)"];
  }
  const rec = body as Record<string, unknown>;
  for (const r of schema.required ?? []) {
    if (!(r in rec)) problems.push(`schema: missing required "${r}"`);
  }
  for (const [k, t] of Object.entries(schema.props ?? {})) {
    if (k in rec && rec[k] != null && !JSON_TYPE[t]?.(rec[k])) {
      problems.push(`schema: "${k}" expected ${t}, got ${typeof rec[k]}`);
    }
  }
  return problems;
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
    if (bad.startsWith("re:")) {
      if (new RegExp(bad.slice(3)).test(obs.bodySnippet)) {
        problems.push(`body leaks /${bad.slice(3)}/`);
      }
    } else if (obs.bodySnippet.includes(bad)) {
      problems.push(`body leaks "${bad}"`);
    }
  }
  for (const [h, want] of Object.entries(expect.headers ?? {})) {
    const got = obs.headers?.[h.toLowerCase()] ?? "";
    if (!got.toLowerCase().includes(want.toLowerCase())) {
      problems.push(`header ${h} lacks "${want}" (got "${got || "—"}")`);
    }
  }
  const j = expect.json;
  if (j) {
    if (obs.bodyJson === undefined && ((j.present?.length ?? 0) + (j.absent?.length ?? 0)
        + Object.keys(j.equals ?? {}).length + Object.keys(j.regex ?? {}).length) > 0) {
      problems.push("body is not JSON (json.* asserts)");
    } else {
      for (const p of j.present ?? []) {
        if (getPath(obs.bodyJson, p) === undefined) problems.push(`json.present missing "${p}"`);
      }
      for (const p of j.absent ?? []) {
        if (getPath(obs.bodyJson, p) !== undefined) problems.push(`json.absent leaked "${p}"`);
      }
      for (const [p, want] of Object.entries(j.equals ?? {})) {
        const got = getPath(obs.bodyJson, p);
        if (got !== want) problems.push(`json.equals "${p}" = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      }
      for (const [p, re] of Object.entries(j.regex ?? {})) {
        const got = getPath(obs.bodyJson, p);
        if (got === undefined || !new RegExp(re).test(String(got))) {
          problems.push(`json.regex "${p}"=${JSON.stringify(got)} !~ /${re}/`);
        }
      }
      if (j.schema) problems.push(...checkSchemaLite(obs.bodyJson, j.schema));
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
