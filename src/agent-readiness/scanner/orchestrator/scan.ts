import type { CacheProvider } from "@agentbadge/cache";
import { resolveAndPin } from "../ssrf/dns-pin";
import { resolveBundleIds, resourcesForBundles } from "../../rule-bundles";
import { AGENT_READINESS_RULESET } from "../../ruleset";
import { ScannerRateLimiter } from "../rate-limiter";
import { SnapshotCache } from "../cache";
import type { ResponseSnapshot } from "../snapshot";
import { assembleSourceState, type SourceState } from "../source-state";
import { fetchResource } from "./dispatch";
import {
  DEFAULT_RESOURCES,
  type AuthProbeContext,
  type CredentialSecurityContext,
  type EndpointProbeContext,
  type OperationalDiscoveryContext,
  type ScanOptions,
} from "./types";

/**
 * Shared L2 cache provider for cross-scan resource caching (EPIC-144).
 * Returns undefined when CACHE_ENABLED is off or when server env isn't
 * initialized (CLI context) — SnapshotCache then runs L1-only, identical
 * to pre-144 behavior.
 */
async function resolveSharedProvider(): Promise<CacheProvider | undefined> {
  try {
    // Lazy imports keep the scanner usable without server env loaded.
    const { getConfig } = await import("../../../config/env");
    if (!getConfig().cache?.enabled) return undefined;
    const { getCache } = await import("../../../server/lib/cache");
    return getCache();
  } catch {
    return undefined;
  }
}

const PARALLEL_RESOURCES = [
  "robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard",
  "skill", "agents_txt", "webmcp", "llms_full", "rss_feed", "mcp_probe",
  "homepage_meta", "infrastructure", "a2a", "identity", "bot_auth", "favicon",
  "pricing", "link_headers", "api_catalog", "oauth_protected_resource",
  "auth_md", "agent_skills", "content_signals", "web_bot_auth", "dns_aid",
  "webmcp_runtime", "l402", "og_meta", "aeo_content", "semantic_html",
  "accessibility", "content_depth", "agent_card", "ai_sitemap",
  "oauth_authorization_server", "llm_policy", "aauth", "heartbeat",
  "skill_json", "error_catalog", "agent_feeds",
];

export async function scanDomain(
  url: string,
  opts?: ScanOptions,
): Promise<SourceState> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid URL protocol: ${parsed.protocol}`);
  }

  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const domain = parsed.hostname;

  // Resolve and pin DNS
  await resolveAndPin(domain);

  const rateLimiter = new ScannerRateLimiter();
  // EPIC-144: shared L2 provider — explicit override wins, else resolved
  // from server env (CACHE_ENABLED). CLI without server env → L1 only.
  const shared = opts?.cacheProvider ?? (await resolveSharedProvider());
  const cache = opts?.noCache ? null : new SnapshotCache({}, shared);
  // EPIC-133: bundle-scoped fetch — explicit `resources` wins over `bundles`.
  let resources = opts?.resources ?? [...DEFAULT_RESOURCES];
  if (!opts?.resources?.length && opts?.bundles?.length) {
    const { ok } = resolveBundleIds(opts.bundles);
    if (ok.length > 0) {
      resources = resourcesForBundles(ok, AGENT_READINESS_RULESET.rules);
    }
  }

  // Conditionally add auth_probe when authTest is enabled and credentials are provided
  const authEnabled = opts?.authTest === true && !!opts?.clientId && !!opts?.clientSecret;
  if (authEnabled && !resources.includes("auth_probe")) {
    resources = [...resources, "auth_probe"];
  }

  // Conditionally add endpoint_probe when probe is enabled
  if (opts?.probe === true && !resources.includes("endpoint_probe")) {
    resources = [...resources, "endpoint_probe"];
  }

  const snapshots: Record<string, ResponseSnapshot | null> = {};
  let completed = 0;
  const total = resources.length;

  // Parallel: robots + sitemap + llms + new fetchers
  const parallelResources = resources.filter((r) => PARALLEL_RESOURCES.includes(r));
  const sequentialResources = resources.filter((r) => !PARALLEL_RESOURCES.includes(r));

  await Promise.all(parallelResources.map(async (resource) => {
    const result = await fetchResource(resource, baseUrl, rateLimiter, cache);
    snapshots[resource] = result;
    completed++;
    opts?.onProgress?.(resource, completed, total);
  }));

  // Build auth probe context after oauth_authorization_server is fetched
  const authContext: AuthProbeContext | undefined = authEnabled
    ? {
      credentials: { clientId: opts!.clientId!, clientSecret: opts!.clientSecret! },
      oauthSnapshot: snapshots["oauth_authorization_server"] ?? null,
    }
    : undefined;

  // Sequential: guide, openapi, mcp, auth_probe (needs oauth snapshot), endpoint_probe (needs openapi)
  for (const resource of sequentialResources) {
    // Build endpoint probe context once openapi snapshot is available
    const epCtx: EndpointProbeContext | undefined = opts?.probe === true && resource === "endpoint_probe"
      ? {
        openapiSnapshot: snapshots["openapi"] ?? null,
        maxEndpoints: opts?.probeEndpoints ?? 3,
      }
      : undefined;
    const odCtx: OperationalDiscoveryContext | undefined = resource === "operational_discovery"
      ? { homepageSnapshot: snapshots["homepage_meta"] ?? null }
      : undefined;
    const csCtx: CredentialSecurityContext | undefined = resource === "credential_security"
      ? { oauthBody: snapshots["oauth_authorization_server"]?.body ?? null, openapiBody: snapshots["openapi"]?.body ?? null }
      : undefined;
    const result = await fetchResource(resource, baseUrl, rateLimiter, cache, authContext, epCtx, odCtx, csCtx);
    snapshots[resource] = result;
    completed++;
    opts?.onProgress?.(resource, completed, total);
  }

  return assembleSourceState(domain, snapshots);
}
