/**
 * Blog article link check (e2e).
 *
 * Renders /blog/<slug> in-process (makeTestApp — no live server needed),
 * extracts every href/src from the page, then verifies each link:
 *   - same-origin (/path, https://agentbadge.xyz/...) → resolved against the
 *     in-process app, redirects followed, expect status < 400;
 *   - external (github.com, dev.to, …) → real network fetch, expect < 400.
 *     Bot-blocks (401/403/429/999) are reported as WARN, not FAIL — they mean
 *     "bot rejected", not "dead link".
 *
 * Usage:
 *   bun scripts/blog-link-check.mts <slug> [<slug> ...]          # vs :4021 dev server
 *   bun scripts/blog-link-check.mts --all
 *   bun scripts/blog-link-check.mts <slug> --base http://localhost:4021
 *   bun scripts/blog-link-check.mts <slug> --base https://agentbadge.xyz
 *   bun scripts/blog-link-check.mts <slug> --in-process          # no server, statics warn
 *   bun scripts/blog-link-check.mts <slug> --only-internal       # skip external fetch
 *
 * Exit: 0 = all OK (warnings allowed), 1 = at least one dead link.
 *
 * NOTE: --in-process serves routes via makeTestApp; static assets and
 * conditionally-mounted routes may report false 404s there — use a live
 * dev server for the authoritative pre-publish check.
 */
import { BLOG_ARTICLES } from "../src/server/lib/blog-data";

const ARGS = process.argv.slice(2);
const ALL = ARGS.includes("--all");
const ONLY_INTERNAL = ARGS.includes("--only-internal");
const IN_PROCESS = ARGS.includes("--in-process");
const BASE_URL_ARG = ARGS.includes("--base") ? ARGS[ARGS.indexOf("--base") + 1] : undefined;
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 5;
const SOFT_STATUSES = new Set([401, 403, 429, 999]);

const FLAG_VALUE_ARGS = new Set(["--base"]);
const slugs = ALL
  ? BLOG_ARTICLES.map((a) => a.slug)
  : ARGS.filter((a, i) => !a.startsWith("--") && !FLAG_VALUE_ARGS.has(ARGS[i - 1]));

if (slugs.length === 0) {
  console.error("usage: bun scripts/blog-link-check.mts <slug> [<slug>...] | --all [--only-internal]");
  process.exit(2);
}
for (const s of slugs) {
  if (!BLOG_ARTICLES.some((a) => a.slug === s)) {
    console.error(`unknown article slug: ${s}`);
    process.exit(2);
  }
}

type LinkKind = "internal" | "external";
interface LinkRef {
  url: string;
  kind: LinkKind;
}
interface LinkResult extends LinkRef {
  status: number | "TIMEOUT" | "ERROR" | "SKIP";
  verdict: "OK" | "WARN" | "FAIL";
  note?: string;
}

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|#|data:)/i;
const BASE = "https://agentbadge.xyz";

/** Limit link extraction to the article content zone (<main>…</main> —
 *  includes FOR AI AGENTS, claims evidence, related links; excludes nav +
 *  site footer chrome, which is site-wide and belongs to layout checks).
 *  NOTE: the article itself contains a <footer> (meta) — never cut on it. */
function articleZone(html: string): string {
  const start = html.indexOf("<main");
  if (start === -1) return html;
  const end = html.indexOf("</main>", start);
  return html.slice(start, end === -1 ? undefined : end + "</main>".length);
}

function extractLinks(html: string): LinkRef[] {
  const urls = new Map<string, LinkRef>();
  for (const m of articleZone(html).matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (SKIP_SCHEMES.test(raw)) continue;
    if (raw.startsWith("//")) continue; // protocol-relative — rare, skip
    if (raw.startsWith("/")) {
      urls.set(raw, { url: raw, kind: "internal" });
    } else if (/^https?:\/\/agentbadge\.xyz\//.test(raw)) {
      const u = new URL(raw);
      urls.set(raw, { url: u.pathname + u.search, kind: "internal" });
    } else if (raw.startsWith("http")) {
      urls.set(raw, { url: raw, kind: "external" });
    }
  }
  return [...urls.values()];
}

type InternalFetch = (path: string) => Promise<Response>;

async function checkInternal(path: string, get: InternalFetch): Promise<LinkResult> {
  let current = path;
  try {
    for (let i = 0; i < 4; i++) {
      const res = await get(current);
      const status = res.status;
      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { url: path, kind: "internal", status, verdict: "OK" };
        const u = new URL(loc, BASE);
        if (u.origin === BASE || loc.startsWith("/")) {
          current = u.pathname + u.search;
          continue;
        }
        // internal link redirecting off-site — treat as OK (external hop)
        return { url: path, kind: "internal", status, verdict: "OK", note: `→ ${u.href}` };
      }
      return {
        url: path,
        kind: "internal",
        status,
        verdict: status < 400 ? "OK" : "FAIL",
      };
    }
    return { url: path, kind: "internal", status: 0, verdict: "FAIL", note: "redirect loop" };
  } catch (e) {
    return { url: path, kind: "internal", status: "ERROR", verdict: "FAIL", note: String(e).slice(0, 120) };
  }
}

async function checkExternal(url: string): Promise<LinkResult> {
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
    const status = res.status;
    if (status < 400) return { url, kind: "external", status, verdict: "OK" };
    if (SOFT_STATUSES.has(status))
      return { url, kind: "external", status, verdict: "WARN", note: "bot-blocked, not necessarily dead" };
    return { url, kind: "external", status, verdict: "FAIL" };
  } catch (e) {
    const msg = String(e);
    const timedOut = /timeout|TimeoutError|abort/i.test(msg);
    return {
      url,
      kind: "external",
      status: timedOut ? "TIMEOUT" : "ERROR",
      verdict: timedOut ? "WARN" : "FAIL",
      note: msg.slice(0, 120),
    };
  }
}

async function runPool<T>(items: LinkRef[], fn: (l: LinkRef) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main() {
  let get: InternalFetch;
  let pageHtml: (path: string) => Promise<Response>;

  if (IN_PROCESS) {
    const { makeTestApp, setupMockEnv } = await import("../tests/e2e/helpers");
    setupMockEnv();
    const app = makeTestApp();
    get = (p) => Promise.resolve(app.request(p));
    pageHtml = get;
    console.log("mode: in-process app (static assets may false-404)");
  } else {
    const base = (BASE_URL_ARG ?? "http://localhost:4021").replace(/\/+$/, "");
    get = (p) => fetch(`${base}${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    pageHtml = get;
    console.log(`mode: live server ${base}`);
  }

  let totalFail = 0;
  for (const slug of slugs) {
    const res = await pageHtml(`/blog/${slug}`);
    if (res.status !== 200) {
      console.error(`\n✗ /blog/${slug} → ${res.status} (article page itself broken)`);
      totalFail++;
      continue;
    }
    const html = await res.text();
    const links = extractLinks(html);
    console.log(`\n## ${slug} — ${links.length} unique links`);

    const results = await runPool(links, (l) => {
      if (l.kind === "internal") return checkInternal(l.url, get);
      if (ONLY_INTERNAL)
        return Promise.resolve<LinkResult>({ url: l.url, kind: "external", status: "SKIP", verdict: "WARN" });
      return checkExternal(l.url);
    });

    const fails = results.filter((r) => r.verdict === "FAIL");
    const warns = results.filter((r) => r.verdict === "WARN");
    for (const r of results.filter((r) => r.verdict !== "OK")) {
      console.log(`  ${r.verdict === "FAIL" ? "✗ FAIL" : "⚠ WARN"} [${r.status}] ${r.url}${r.note ? ` — ${r.note}` : ""}`);
    }
    console.log(`  → ${results.length - fails.length - warns.length} ok, ${warns.length} warn, ${fails.length} FAIL`);
    totalFail += fails.length;
  }
  console.log(totalFail === 0 ? "\nALL LINKS OK" : `\n${totalFail} DEAD LINK(S)`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main();
