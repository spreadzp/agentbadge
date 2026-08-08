import { createHash } from "node:crypto";

export interface ResponseSnapshot {
  url: string;
  status: number;
  bodyHash: string;
  bodySize: number;
  contentType: string | null;
  resolvedIp: string | null;
  fetchedAt: string;
  fetchTimeMs: number;
  redirectChain: string[];
  body?: string | null;
  headers?: Record<string, string>;
}

export function createSnapshot(opts: {
  url: string;
  status: number;
  body: ArrayBuffer | string | null;
  contentType?: string | null;
  resolvedIp?: string | null;
  fetchTimeMs?: number;
  redirectChain?: string[];
  headers?: Record<string, string>;
}): ResponseSnapshot {
  const bodyData = opts.body === null ? null :
    typeof opts.body === "string" ? Buffer.from(opts.body) : Buffer.from(opts.body);
  return {
    url: opts.url,
    status: opts.status,
    bodyHash: bodyData ? createHash("sha256").update(bodyData).digest("hex") : "",
    bodySize: bodyData?.byteLength ?? 0,
    contentType: opts.contentType ?? null,
    resolvedIp: opts.resolvedIp ?? null,
    fetchedAt: new Date().toISOString(),
    fetchTimeMs: opts.fetchTimeMs ?? 0,
    redirectChain: opts.redirectChain ?? [],
    body: typeof opts.body === "string" ? opts.body : (bodyData ? bodyData.toString("utf-8") : null),
    headers: opts.headers ?? {},
  };
}
