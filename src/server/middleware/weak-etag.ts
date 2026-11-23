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
    // NOTE: do NOT use res.clone() here — Bun's clone() on a streamed body
    // leaves the original empty in production (200 + 0B). Consume the body
    // and rebuild the Response instead.
    const buf = await c.res.arrayBuffer();
    if (buf.byteLength === 0) return;
    const etag = `W/"${createHash("sha256").update(Buffer.from(buf)).digest("hex").slice(0, 16)}"`;
    const headers = new Headers(c.res.headers);
    headers.set("ETag", etag);
    if (c.req.header("if-none-match") === etag) {
      const minimal = new Headers();
      for (const name of HOP_HEADERS) {
        const value = headers.get(name);
        if (value) minimal.set(name, value);
      }
      c.res = new Response(null, { status: 304, headers: minimal });
      return;
    }
    c.res = new Response(buf, { status: 200, headers });
  };
}
