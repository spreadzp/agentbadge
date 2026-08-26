import { resolveAndPin } from "./ssrf/dns-pin";
import { ScannerRateLimiter } from "./rate-limiter";
import { SnapshotCache } from "./cache";
import { createSnapshot, type ResponseSnapshot } from "./snapshot";
import { assembleSourceState, type SourceState } from "./source-state";
import { fetchRobotsTxt } from "./fetchers/robots-fetcher";
import { fetchSitemapXml } from "./fetchers/sitemap-fetcher";
import { fetchAgentGuide } from "./fetchers/guide-fetcher";
import { fetchOpenApi } from "./fetchers/openapi-fetcher";
import { fetchMcpDescriptor } from "./fetchers/mcp-fetcher";
import { fetchLlmsTxt } from "./fetchers/llms-txt-fetcher";
import { fetchContentNegotiation } from "./fetchers/content-negotiation-fetcher";
import { fetchX402Discovery } from "./fetchers/x402-fetcher";
import { fetchL402Challenge } from "./fetchers/l402-fetcher";
import { fetchOpenApiStandard } from "./fetchers/openapi-standard-fetcher";
import { fetchSkillFile } from "./fetchers/skill-file-fetcher";
import { fetchAgentsTxt } from "./fetchers/agents-txt-fetcher";
import { fetchWebMcp } from "./fetchers/webmcp-fetcher";
import { fetchLlmsFull } from "./fetchers/llms-full-fetcher";
import { fetchRssFeed } from "./fetchers/rss-feed-fetcher";
import { fetchMcpProbe } from "./fetchers/mcp-probe-fetcher";
import { fetchHomepageMeta } from "./fetchers/homepage-meta-fetcher";
import { fetchInfrastructure } from "./fetchers/infrastructure-fetcher";
import { fetchA2A } from "./fetchers/a2a-fetcher";
import { fetchIdentity } from "./fetchers/identity-fetcher";
import { fetchBotAuth } from "./fetchers/bot-auth-fetcher";
import { fetchFavicon } from "./fetchers/favicon-fetcher";
import { fetchPricing } from "./fetchers/pricing-fetcher";
import { fetchLinkHeaders } from "./fetchers/link-headers-fetcher";
import { fetchApiCatalog } from "./fetchers/api-catalog-fetcher";
import { fetchOauthProtectedResource } from "./fetchers/oauth-protected-resource-fetcher";
import { fetchAuthMd } from "./fetchers/auth-md-fetcher";
import { fetchAgentSkills } from "./fetchers/agent-skills-fetcher";
import { fetchContentSignals } from "./fetchers/content-signals-fetcher";
import { fetchWebBotAuth } from "./fetchers/web-bot-auth-fetcher";
import { fetchDnsAid } from "./fetchers/dns-aid-fetcher";
import { fetchWebmcpRuntime } from "./fetchers/webmcp-runtime-fetcher";
import { fetchOgMeta } from "./fetchers/og-meta-fetcher";
import { fetchAeoContent } from "./fetchers/aeo-content-fetcher";
import { fetchSemanticHtml } from "./fetchers/semantic-html-fetcher";
import { fetchAccessibility } from "./fetchers/accessibility-fetcher";
import { fetchContentDepth } from "./fetchers/content-depth-fetcher";
import { fetchAgentCard } from "./fetchers/agent-card-fetcher";
import { fetchAiSitemap } from "./fetchers/ai-sitemap-fetcher";
import { fetchOauthAuthorizationServer } from "./fetchers/oauth-authorization-server-fetcher";
import { fetchLlmPolicy } from "./fetchers/llm-policy-fetcher";
import { fetchAuthProbe, type AuthProbeCredentials } from "./fetchers/auth-probe-fetcher";

export interface ScanOptions {
  noCache?: boolean;
  timeout?: number;
  resources?: string[];
  onProgress?: (resource: string, completed: number, total: number) => void;
  authTest?: boolean;
  clientId?: string;
  clientSecret?: string;
}

interface AuthProbeContext {
  credentials: AuthProbeCredentials;
  oauthSnapshot: ResponseSnapshot | null;
}

export const DEFAULT_RESOURCES = [
  "robots",
  "sitemap",
  "guide",
  "openapi",
  "mcp",
  "llms",
  "content_negotiation",
  "x402",
  "openapi_standard",
  "skill",
  "agents_txt",
  "webmcp",
  "llms_full",
  "rss_feed",
  "mcp_probe",
  "homepage_meta",
  "infrastructure",
  "a2a",
  "identity",
  "bot_auth",
  "favicon",
  "pricing",
  "link_headers",
  "api_catalog",
  "oauth_protected_resource",
  "auth_md",
  "agent_skills",
  "content_signals",
  "web_bot_auth",
  "dns_aid",
  "webmcp_runtime",
  "l402",
  "og_meta",
  "aeo_content",
  "semantic_html",
  "accessibility",
  "content_depth",
  "agent_card",
  "ai_sitemap",
  "oauth_authorization_server",
  "llm_policy",
] as const;

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
  const cache = opts?.noCache ? null : new SnapshotCache();
  let resources = opts?.resources ?? [...DEFAULT_RESOURCES];

  // Conditionally add auth_probe when authTest is enabled and credentials are provided
  const authEnabled = opts?.authTest === true && !!opts?.clientId && !!opts?.clientSecret;
  if (authEnabled && !resources.includes("auth_probe")) {
    resources = [...resources, "auth_probe"];
  }

  const snapshots: Record<string, ResponseSnapshot | null> = {};
  let completed = 0;
  const total = resources.length;

  // Parallel: robots + sitemap + llms + new fetchers
  const parallelResources = resources.filter((r) =>
    ["robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard", "skill", "agents_txt", "webmcp", "llms_full", "rss_feed", "mcp_probe", "homepage_meta", "infrastructure", "a2a", "identity", "bot_auth", "favicon", "pricing", "link_headers", "api_catalog", "oauth_protected_resource", "auth_md", "agent_skills", "content_signals", "web_bot_auth", "dns_aid", "webmcp_runtime", "l402", "og_meta", "aeo_content", "semantic_html", "accessibility", "content_depth", "agent_card", "ai_sitemap", "oauth_authorization_server", "llm_policy"].includes(r),
  );
  const sequentialResources = resources.filter(
    (r) =>
      !["robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard", "skill", "agents_txt", "webmcp", "llms_full", "rss_feed", "mcp_probe", "homepage_meta", "infrastructure", "a2a", "identity", "bot_auth", "favicon", "pricing", "link_headers", "api_catalog", "oauth_protected_resource", "auth_md", "agent_skills", "content_signals", "web_bot_auth", "dns_aid", "webmcp_runtime", "l402", "og_meta", "aeo_content", "semantic_html", "accessibility", "content_depth", "agent_card", "ai_sitemap", "oauth_authorization_server", "llm_policy"].includes(r),
  );

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

  // Sequential: guide, openapi, mcp, auth_probe (needs oauth snapshot)
  for (const resource of sequentialResources) {
    const result = await fetchResource(resource, baseUrl, rateLimiter, cache, authContext);
    snapshots[resource] = result;
    completed++;
    opts?.onProgress?.(resource, completed, total);
  }

  return assembleSourceState(domain, snapshots);
}

async function fetchResource(
  resource: string,
  baseUrl: string,
  rateLimiter: ScannerRateLimiter,
  cache: SnapshotCache | null,
  authContext?: AuthProbeContext,
): Promise<ResponseSnapshot | null> {
  const cacheKey = `${baseUrl}/${resource}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const check = rateLimiter.checkDomain(new URL(baseUrl).hostname);
  if (!check.allowed) {
    await new Promise((r) => setTimeout(r, check.retryAfterMs));
  }
  rateLimiter.recordRequest(new URL(baseUrl).hostname);

  let snapshot: ResponseSnapshot | null = null;

  switch (resource) {
    case "robots": {
      const r = await fetchRobotsTxt(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "sitemap": {
      const r = await fetchSitemapXml(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "guide": {
      const r = await fetchAgentGuide(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "openapi": {
      const r = await fetchOpenApi(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "mcp": {
      const r = await fetchMcpDescriptor(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "llms": {
      const r = await fetchLlmsTxt(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "content_negotiation": {
      const r = await fetchContentNegotiation(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime, headers: r.headers,
      }) : null;
      break;
    }
    case "x402": {
      const r = await fetchX402Discovery(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "openapi_standard": {
      const r = await fetchOpenApiStandard(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "skill": {
      const r = await fetchSkillFile(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "agents_txt": {
      const r = await fetchAgentsTxt(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "webmcp": {
      const r = await fetchWebMcp(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "llms_full": {
      const r = await fetchLlmsFull(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "rss_feed": {
      const r = await fetchRssFeed(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "mcp_probe": {
      const r = await fetchMcpProbe(baseUrl);
      snapshot = createSnapshot({
        url: `${baseUrl}/mcp`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "homepage_meta": {
      const r = await fetchHomepageMeta(baseUrl);
      snapshot = createSnapshot({
        url: `${baseUrl}/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "infrastructure": {
      const r = await fetchInfrastructure(baseUrl);
      snapshot = createSnapshot({
        url: baseUrl, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "a2a": {
      const r = await fetchA2A(baseUrl);
      snapshot = createSnapshot({
        url: `${baseUrl}/.well-known/agent-card.json`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "identity": {
      const r = await fetchIdentity(baseUrl);
      snapshot = createSnapshot({
        url: `${baseUrl}/.well-known/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "bot_auth": {
      const r = await fetchBotAuth(baseUrl);
      snapshot = createSnapshot({
        url: `${baseUrl}/.well-known/http-message-signatures-directory`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "favicon": {
      const r = await fetchFavicon(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "pricing": {
      const r = await fetchPricing(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "link_headers": {
      const r = await fetchLinkHeaders(baseUrl);
      snapshot = createSnapshot({
        url: r.url, status: r.status, body: JSON.stringify(r),
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      });
      break;
    }
    case "api_catalog": {
      const r = await fetchApiCatalog(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "oauth_protected_resource": {
      const r = await fetchOauthProtectedResource(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "auth_md": {
      const r = await fetchAuthMd(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "agent_skills": {
      const r = await fetchAgentSkills(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "content_signals": {
      const r = await fetchContentSignals(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: JSON.stringify(r),
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "web_bot_auth": {
      const r = await fetchWebBotAuth(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "dns_aid": {
      const domain = new URL(baseUrl).hostname;
      const r = await fetchDnsAid(domain);
      snapshot = createSnapshot({
        url: `_agent.${domain}`, status: r.found ? 200 : 404, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: r.fetchTime,
      });
      break;
    }
    case "webmcp_runtime": {
      const r = await fetchWebmcpRuntime(baseUrl);
      snapshot = createSnapshot({
        url: r.url, status: r.status, body: JSON.stringify(r),
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      });
      break;
    }
    case "l402": {
      const r = await fetchL402Challenge(baseUrl);
      snapshot = createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime, headers: r.headers,
      });
      break;
    }
    case "og_meta": {
      const r = await fetchOgMeta(`${baseUrl}/`);
      snapshot = createSnapshot({
        url: `${baseUrl}/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "aeo_content": {
      const r = await fetchAeoContent(`${baseUrl}/`);
      snapshot = createSnapshot({
        url: `${baseUrl}/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "semantic_html": {
      const r = await fetchSemanticHtml(`${baseUrl}/`);
      snapshot = createSnapshot({
        url: `${baseUrl}/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "accessibility": {
      const r = await fetchAccessibility(`${baseUrl}/`);
      snapshot = createSnapshot({
        url: `${baseUrl}/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "content_depth": {
      const r = await fetchContentDepth(`${baseUrl}/`);
      snapshot = createSnapshot({
        url: `${baseUrl}/`, status: 200, body: JSON.stringify(r),
        resolvedIp: null, fetchTimeMs: 0,
      });
      break;
    }
    case "agent_card": {
      const r = await fetchAgentCard(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "ai_sitemap": {
      const r = await fetchAiSitemap(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "oauth_authorization_server": {
      const r = await fetchOauthAuthorizationServer(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "llm_policy": {
      const r = await fetchLlmPolicy(baseUrl);
      snapshot = r.body !== null ? createSnapshot({
        url: r.url, status: r.status, body: r.body,
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
      }) : null;
      break;
    }
    case "auth_probe": {
      if (!authContext) {
        snapshot = null;
        break;
      }
      const result = await fetchAuthProbe(baseUrl, authContext.oauthSnapshot, authContext.credentials);
      snapshot = createSnapshot({
        url: `${baseUrl}/auth-probe`,
        status: 200,
        body: JSON.stringify(result),
        resolvedIp: null,
        fetchTimeMs: 0,
      });
      break;
    }
  }

  if (snapshot && cache) {
    cache.set(cacheKey, snapshot);
  }

  return snapshot;
}
