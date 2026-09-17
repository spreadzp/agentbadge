import type { MiddlewareHandler } from "hono";

/**
 * SLICE-81-1: Host + path normalization (www→apex 301, trailing-slash 301, fly.dev exact-match)
 * SLICE-131-1: force https scheme — behind the reverse proxy c.req.url is http://,
 * so absolute redirects must not inherit the internal scheme.
 */
const REDIRECT_HOSTS: Record<string, string> = {
  "www.agentbadge.xyz": "agentbadge.xyz",
  "agent-passport-hedera.fly.dev": "agentbadge.xyz",
};

const PROD_HOSTS = new Set(["agentbadge.xyz", ...Object.keys(REDIRECT_HOSTS)]);

/** Force https for public production hosts; keep scheme for localhost/dev. */
function canonicalProtocol(url: URL): void {
  if (PROD_HOSTS.has(url.host)) {
    url.protocol = "https:";
  }
}

/** 301 redirect for known alias hosts (www→apex, fly.dev→apex). */
export const hostNormalizationMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const host = c.req.header("host") ?? "";
    const targetHost = REDIRECT_HOSTS[host];
    if (targetHost) {
      const url = new URL(c.req.url);
      url.host = targetHost;
      url.protocol = "https:";
      return c.redirect(url.toString(), 301);
    }
    await next();
  };
};

/** 301 redirect stripping a trailing slash (path length > 1). */
export const trailingSlashMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const path = c.req.path;
    if (path.length > 1 && path.endsWith("/")) {
      const url = new URL(c.req.url);
      url.pathname = path.slice(0, -1);
      canonicalProtocol(url);
      return c.redirect(url.toString(), 301);
    }
    await next();
  };
};
