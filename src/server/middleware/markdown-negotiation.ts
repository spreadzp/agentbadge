/**
 * SLICE-178-4 (MYPROJ-2517): markdown negotiation + `.md` mirrors.
 *
 * Two pieces, one canonical renderer (D-178-3):
 *
 * 1. `markdownNegotiation()` — post-response middleware. When a GET request
 *    prefers `text/markdown` over `text/html` (Accept q-values honoured) and
 *    the handler produced HTML on a public page, the body is re-rendered via
 *    `htmlToMarkdown` and returned as `text/markdown` with `Vary: Accept`.
 *    Default (no header / html wins) is byte-for-byte untouched.
 *
 * 2. `markdownMirrorRoutes(app)` — `GET /<path>.md` catch route. Internally
 *    re-requests the stripped path with `Accept: text/markdown`, so the mirror
 *    is the negotiated response by construction (AC2). Non-markdown results
 *    (API JSON, 404s, excluded paths) → 404.
 *
 * Scope: any public GET page that renders `text/html`. Excluded: `/api/*`,
 * `/.well-known/*`, `/mcp`, admin/ops/auth flows, and asset paths (anything
 * whose last segment already carries an extension other than `.md`).
 * Blog `.md` routes are owned by SLICE-60-2 (`/blog/:slug.md`) — untouched.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { htmlToMarkdown } from "../lib/agent-discovery/markdown";
import { BASE_URL } from "../lib/page-meta";
import { recordSrcAttribution } from "./src-attribution";
import {
  headOf,
  isJsonContentType,
  notAcceptable,
  pickPreferred,
  serveJsonMirror,
  serveMarkdownMirror,
} from "./markdown-negotiation-helpers";

export { setMirrorApp } from "./markdown-negotiation-helpers";

// ─── Scope ───────────────────────────────────────────────────────────────────

const EXCLUDED_PREFIXES = [
  "/api/",
  "/.well-known/",
  "/mcp",
  "/linkedin/",
  "/payment",
  "/work-requests",
  "/admin",
  "/monitoring",
  "/assets/",
  "/icons/",
  "/images/",
  "/css/",
  "/js/",
];

export function isMarkdownNegotiablePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.endsWith(".md")) return false; // handled by the mirror route
  if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return false;
  // Asset-like last segments (foo.css, favicon.ico, feed) are not pages.
  const last = path.split("/").pop() ?? "";
  if (/\.[a-z0-9]+$/i.test(last)) return false;
  return true;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export function markdownNegotiation() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // SLICE-259-16: HEAD runs the same negotiation as GET — the
    // response is computed normally and the body dropped at the end.
    const isHead = c.req.method === "HEAD";
    if (c.req.method !== "GET" && !isHead) {
      await next();
      return;
    }
    const path = new URL(c.req.url).pathname;

    // `.md` suffix: real routes keep ownership of their extension (e.g.
    // /blog/:slug.md, /auth.md). Anything that still 404s — including paths
    // shadowed by param routes like /rules/:id matching "AB-007.md" —
    // falls back to the negotiated mirror so the advertised
    // <link rel="alternate" type="text/markdown"> never 404s (audit P0).
    if (path.endsWith(".md")) {
      await next();
      if (c.res.status !== 404) {
        if (isHead) c.res = headOf(c.res);
        return;
      }
      // SLICE-178-5: ?src= attribution on .md entry points.
      await recordSrcAttribution(c);
      const mirrored = await serveMarkdownMirror(path, new URL(c.req.url).search);
      if (mirrored) c.res = mirrored;
      if (isHead) c.res = headOf(c.res);
      return;
    }

    if (!isMarkdownNegotiablePath(path)) {
      await next();
      return;
    }
    const preferred = pickPreferred(c.req.header("Accept"));

    await next();
    const res = c.res;
    const resType = res.headers.get("content-type") ?? "";

    if (preferred === "json" && !isJsonContentType(resType)) {
      // Uniform policy (SLICE-259-16): `<path>.json` is THE structured
      // representation for a resource — whatever its default media type
      // (text/html page, application/rss+xml feed). Mirror exists →
      // serve it; it doesn't → honest 406.
      const mirrored = await serveJsonMirror(path);
      c.res = mirrored ?? notAcceptable(path);
      if (isHead) c.res = headOf(c.res);
      return;
    }

    if (!resType.includes("text/html")) {
      if (isHead) c.res = headOf(res);
      return;
    }

    if (preferred !== "md") {
      // HTML stays byte-identical; Vary tells caches the response is
      // negotiated so a markdown variant never leaks to browsers.
      const vary = res.headers.get("vary");
      const headers = new Headers(res.headers);
      headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
      c.res = new Response(isHead ? null : await res.text(), {
        status: res.status,
        headers,
      });
      return;
    }

    const md = htmlToMarkdown(await res.text(), BASE_URL);
    c.res = new Response(isHead ? null : md, {
      status: res.status,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: "Accept",
        "Cache-Control":
          res.headers.get("cache-control") ?? "public, max-age=300",
      },
    });
  };
}

// ─── `.md` mirror routes ─────────────────────────────────────────────────────

/**
 * `GET /<anything>.md` → internal request for the stripped path with
 * `Accept: text/markdown`. Whatever the negotiation layer returns is the
 * mirror body — identical content by construction. Anything that isn't
 * markdown (JSON APIs, missing pages) yields 404.
 */
export function markdownMirrorRoutes(_app: Hono): Hono {
  const routes = new Hono();

  routes.get("*", async (c) => {
    const path = new URL(c.req.url).pathname;
    if (!path.endsWith(".md")) return c.notFound();

    // SLICE-178-5: ?src= attribution on .md entry points.
    await recordSrcAttribution(c);

    const mirrored = await serveMarkdownMirror(path, new URL(c.req.url).search);
    if (!mirrored) return c.notFound();
    return mirrored;
  });

  return routes;
}
