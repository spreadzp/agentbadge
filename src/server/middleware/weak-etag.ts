// SLICE-259-37: weak ETag + 304 revalidation for generated agent-facing
// surfaces (manifests, policy text, sitemaps). These bodies are produced
// per-request but byte-stable — agents re-fetch robots/llms/well-known
// docs every run, so If-None-Match must answer cheaply.

import { createHash } from "node:crypto";
import type { Context, Next } from "hono";

const HOP_HEADERS = ["ETag", "Cache-Control", "Content-Type", "Vary"] as const;

export function weakEtag() {
  return async (c: Context, next: Next) => {
    await next();
    if (
      c.req.method !== "GET" ||
      c.res.status !== 200 ||
      c.res.headers.has("etag") ||
      !c.res.body
    ) {
      return;
    }
    const body = await c.res.clone().text();
    if (!body) return;
    const etag = `W/"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
    c.res.headers.set("ETag", etag);
    if (c.req.header("if-none-match") === etag) {
      const headers = new Headers();
      for (const name of HOP_HEADERS) {
        const value = c.res.headers.get(name);
        if (value) headers.set(name, value);
      }
      c.res = new Response(null, { status: 304, headers });
    }
  };
}
