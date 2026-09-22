import type { ResponseSnapshot } from "../snapshot";
import type { AuthProbeCredentials } from "../fetchers/auth-probe-fetcher";
import type { CacheProvider } from "@agentbadge/cache";

export interface ScanOptions {
  noCache?: boolean;
  /**
   * Shared cross-scan cache backend (EPIC-144). When absent, scan.ts
   * resolves it from server env (CACHE_ENABLED); CLI/tests can inject
   * explicitly. `noCache` bypasses both layers regardless.
   */
  cacheProvider?: CacheProvider;
  timeout?: number;
  resources?: string[];
  /**
   * Bundle ids (canonical or legacy alias) scoping which resources to
   * fetch (EPIC-133). Explicit `resources` wins when both are set.
   */
  bundles?: string[];
  onProgress?: (resource: string, completed: number, total: number) => void;
  authTest?: boolean;
  clientId?: string;
  clientSecret?: string;
  probe?: boolean;
  probeEndpoints?: number;
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
  "operational_discovery",
  "aauth",
  "credential_security",
  "heartbeat",
  "skill_json",
  "error_catalog",
  "agent_feeds",
] as const;

export interface AuthProbeContext {
  credentials: AuthProbeCredentials;
  oauthSnapshot: ResponseSnapshot | null;
}

export interface EndpointProbeContext {
  openapiSnapshot: ResponseSnapshot | null;
  maxEndpoints: number;
}

export interface OperationalDiscoveryContext {
  homepageSnapshot: ResponseSnapshot | null;
}

export interface CredentialSecurityContext {
  oauthBody: string | null;
  openapiBody: string | null;
}

/** Per-fetch context handed to every resource handler. */
export interface FetchContext {
  baseUrl: string;
  auth?: AuthProbeContext;
  endpointProbe?: EndpointProbeContext;
  operationalDiscovery?: OperationalDiscoveryContext;
  credentialSecurity?: CredentialSecurityContext;
}

export type ResourceHandler = (ctx: FetchContext) => Promise<ResponseSnapshot | null>;
