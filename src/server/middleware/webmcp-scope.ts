import type { MiddlewareHandler } from "hono";
import { injectWebMCP, toolsFor } from "@agentbadge/webmcp";
import { agentsPageTools } from "../lib/agent-interaction/webmcp-page-tools";

/**
 * SLICE-256-5: page-scoped WebMCP tool injection (D-256-Q5).
 *
 * Maps HTML page paths to PAGE_TOOLSETS keys and appends a
 * feature-detected <script> registering exactly that page's toolset
 * via document.modelContext. No-op outside Chrome OT by design
 * (injectWebMCP emits `if ('modelContext' in document)`), and a no-op
 * here for non-HTML responses and unscoped paths.
 *
 * Path → page key (D-256-Q5):
 *   / | /en-us | /en-gb | /passport       → landing (all groups)
 *   /services/scanner, /agent-readiness   → scanner (readiness + submit/poll)
 *   /services/marketplace, /market/*, /work-requests/:id → market (marketplace + submit/poll)
 *   /verify                               → trust (trust + submit/poll)
 *   /agent-guide*, /guides/*, /rules*     → docs (qa + surveys + onboarding)
 *   /for-agents                           → agents (233-6: exactly the 5
 *     keyless agent-interaction tools — resolved server-side, not via
 *     PAGE_TOOLSETS, until the package republishes the shelf)
 */
const SCOPE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/?$/, "landing"],
  [/^\/(en-us|en-gb|passport)$/, "landing"],
  [/^\/(services\/scanner|agent-readiness)$/, "scanner"],
  [/^\/services\/marketplace$/, "market"],
  [/^\/market(\/|$)/, "market"],
  [/^\/work-requests\//, "market"],
  [/^\/verify$/, "trust"],
  [/^\/(agent-guide|marketplace-guide|market-guide)/, "docs"],
  [/^\/guides\//, "docs"],
  [/^\/rules(\/|$)/, "docs"],
  [/^\/for-agents\/?$/, "agents"],
];

export function webmcpPageScopeForPath(pathname: string): string | null {
  for (const [pattern, page] of SCOPE_RULES) {
    if (pattern.test(pathname)) return page;
  }
  return null;
}

export function webmcpPageScope(): MiddlewareHandler {
  const scripts = new Map<string, string>();
  return async (c, next) => {
    await next();
    const page = webmcpPageScopeForPath(c.req.path);
    const res = c.res;
    if (!page || !(res.headers.get("content-type") ?? "").includes("text/html")) {
      return;
    }
    let script = scripts.get(page);
    if (!script) {
      script = injectWebMCP(
        page === "agents" ? agentsPageTools() : toolsFor({ page }),
      );
      scripts.set(page, script);
    }
    const body = await res.text();
    const idx = body.lastIndexOf("</body>");
    const html =
      idx >= 0 ? `${body.slice(0, idx)}${script}\n${body.slice(idx)}` : body + script;
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    // Discovery affordance on every scoped page (extends the landing
    // Link-header pattern to all injected pages).
    headers.append("Link", '</.well-known/webmcp.json>; rel="service-desc"');
    c.res = new Response(html, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
