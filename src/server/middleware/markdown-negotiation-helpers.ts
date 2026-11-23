/**
 * Helpers for markdown-negotiation.ts — extracted under the 300-line cap:
 * Accept parsing/q-values, the `.md`/`.json` mirror fetchers, 406 and HEAD
 * utilities. Public API is re-exported by ./markdown-negotiation.
 */
import { Hono } from "hono";

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

/** q-value for a media type: exact match, else `type/*`, else `* /*`. */
function qFor(entries: AcceptEntry[], t: string): number | null {
  const exact = entries.find((e) => e.type === t);
  if (exact) return exact.q;
  const wild = entries.find(
    (e) =>
      e.type === "*/*" ||
      (e.type.endsWith("/*") && t.startsWith(e.type.slice(0, -1))),
  );
  return wild ? wild.q : null;
}

export type Preferred = "html" | "md" | "json";

/** Which representation wins for this Accept on an HTML page.
 *  markdown > json on ties (markdown was the first-class variant). */
export function pickPreferred(accept: string | undefined): Preferred {
  if (!accept) return "html";
  const entries = parseAccept(accept);
  const md = qFor(entries, "text/markdown") ?? 0;
  const json = qFor(entries, "application/json") ?? 0;
  const html = qFor(entries, "text/html") ?? 0;
  if (md > html && md >= json) return "md";
  if (json > html) return "json";
  return "html";
}

/** True when the request prefers markdown over html (q or order). */
export function prefersMarkdown(accept: string | undefined): boolean {
  return pickPreferred(accept) === "md";
}

// ─── `.md` / `.json` mirror fetchers ─────────────────────────────────────────

let mirrorApp: Hono | null = null;

/**
 * Late-bound app reference for internal mirror sub-requests. Set once after
 * the app is fully assembled (next to `setDiscoveryApp`) — the middleware is
 * wired before route mounts, so it can't capture `app` directly.
 */
export function setMirrorApp(app: Hono): void {
  mirrorApp = app;
}

/**
 * Internal mirror fetch: re-request `path` minus the `.md` suffix (query kept) with
 * `Accept: text/markdown`. Returns the markdown Response, or null when the
 * target isn't a negotiable page (real 404s, JSON APIs, excluded paths).
 */
export async function serveMarkdownMirror(
  path: string,
  search = "",
): Promise<Response | null> {
  if (!mirrorApp) return null;
  const stripped = path.slice(0, -3);
  // Recursive mirrors are meaningless — /x.md.md must not resolve through
  // the catch-all again, or crawlers discover an infinite .md URL space.
  if (stripped.endsWith(".md")) return null;
  const target = stripped === "" || stripped === "/index" ? "/" : stripped;
  const inner = await mirrorApp.request(target + search, {
    method: "GET",
    headers: { Accept: "text/markdown" },
  });
  if (!inner.ok) return null;
  const ct = inner.headers.get("content-type") ?? "";
  if (!ct.includes("text/markdown")) return null;
  return new Response(await inner.text(), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
    },
  });
}

/**
 * SLICE-259-16: JSON mirrors — `<path>.json` is the structured
 * representation contract for a page (same convention as `.md`).
 * Internal fetch resolves through the real route table: /feed →
 * /feed.json, /faq → /faq.json, /blog/x → /blog/x.json. No mirror →
 * the caller decides (406 for negotiated pages).
 */
/** `application/json` or any `application/*+json` structured suffix
 *  (e.g. `application/a2a+json` agent card — SLICE-259-19). */
export function isJsonContentType(ct: string): boolean {
  const media = ct.split(";")[0]!.trim().toLowerCase();
  return media === "application/json" || (media.startsWith("application/") && media.endsWith("+json"));
}

export async function serveJsonMirror(path: string): Promise<Response | null> {
  if (!mirrorApp) return null;
  const inner = await mirrorApp.request(`${path}.json`, { method: "GET" });
  if (!inner.ok) return null;
  const ct = inner.headers.get("content-type") ?? "";
  if (!isJsonContentType(ct)) return null;
  return new Response(await inner.text(), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Accept",
    },
  });
}

export function notAcceptable(path: string): Response {
  return new Response(
    JSON.stringify(
      {
        error: "not_acceptable",
        message: `No application/json representation for ${path}`,
        available: ["text/html", "text/markdown"],
        hint: `Try ${path === "/" ? "/index" : path}.md or send Accept: text/markdown`,
      },
      null,
      2,
    ),
    {
      status: 406,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Vary: "Accept",
      },
    },
  );
}

/** HEAD: same negotiation as GET, headers preserved, body dropped. */
export function headOf(res: Response): Response {
  return new Response(null, { status: res.status, headers: res.headers });
}
