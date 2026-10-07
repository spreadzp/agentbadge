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

// ─── Accept parsing ──────────────────────────────────────────────────────────

interface AcceptEntry {
  type: string;
  q: number;
}

function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(",")
    .map((part) => {
      const [mediaType, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { type: mediaType.trim().toLowerCase(), q: isNaN(q) ? 1 : q };
    })
    .filter((e) => e.type.length > 0);
}

/** True when the request prefers markdown over html (q or order). */
export function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept) return false;
  const entries = parseAccept(accept);
  const qFor = (t: string): number | null => {
    const exact = entries.find((e) => e.type === t);
    if (exact) return exact.q;
    const wild = entries.find(
      (e) => e.type === "*/*" || (e.type.endsWith("/*") && t.startsWith(e.type.slice(0, -1))),
    );
    return wild ? wild.q : null;
  };
  const md = qFor("text/markdown");
  if (md === null || md === 0) return false;
  const html = qFor("text/html");
  if (html === null) return true;
  return md > html;
}

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
    if (c.req.method !== "GET") {
      await next();
      return;
    }
    const path = new URL(c.req.url).pathname;
    if (!isMarkdownNegotiablePath(path)) {
      await next();
      return;
    }
    const wantsMd = prefersMarkdown(c.req.header("Accept"));

    await next();
    const res = c.res;
    if (!res.headers.get("content-type")?.includes("text/html")) return;

    if (!wantsMd) {
      // HTML stays byte-identical; Vary tells caches the response is
      // negotiated so a markdown variant never leaks to browsers.
      const vary = res.headers.get("vary");
      const headers = new Headers(res.headers);
      headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
      c.res = new Response(await res.text(), {
        status: res.status,
        headers,
      });
      return;
    }

    const md = htmlToMarkdown(await res.text(), BASE_URL);
    c.res = new Response(md, {
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
export function markdownMirrorRoutes(app: Hono): Hono {
  const routes = new Hono();

  routes.get("*", async (c) => {
    const path = new URL(c.req.url).pathname;
    if (!path.endsWith(".md")) return c.notFound();

    // SLICE-178-5: ?src= attribution on .md entry points.
    await recordSrcAttribution(c);

    const stripped = path.slice(0, -3);
    const target = stripped === "" || stripped === "/index" ? "/" : stripped;
    const inner = await app.request(target, {
      method: "GET",
      headers: { Accept: "text/markdown" },
    });
    if (!inner.ok) return c.notFound();
    const ct = inner.headers.get("content-type") ?? "";
    if (!ct.includes("text/markdown")) return c.notFound();
    return new Response(await inner.text(), {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: "Accept",
      },
    });
  });

  return routes;
}
