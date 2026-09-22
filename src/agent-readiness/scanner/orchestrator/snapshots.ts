import { createSnapshot, type ResponseSnapshot } from "../snapshot";

/** Common fetcher return shape: `{ url, status, body, resolvedIp, fetchTime }`. */
export interface FetchOutcome {
  url: string;
  status: number;
  body: string | null;
  resolvedIp?: string | null;
  fetchTime?: number;
  headers?: Record<string, string>;
}

/** `body !== null` → snapshot from fetcher fields, else `null`. */
export function snapOrNull(r: FetchOutcome): ResponseSnapshot | null {
  return r.body !== null
    ? createSnapshot({
        url: r.url,
        status: r.status,
        body: r.body,
        resolvedIp: r.resolvedIp,
        fetchTimeMs: r.fetchTime,
      })
    : null;
}

/** Structured (non-HTTP-body) result → `200` snapshot with JSON body. */
export function snapJson(url: string, r: unknown): ResponseSnapshot {
  return createSnapshot({
    url,
    status: 200,
    body: JSON.stringify(r),
    resolvedIp: null,
    fetchTimeMs: 0,
  });
}
