import { fetchRobotsTxt } from "../fetchers/robots-fetcher";
import { fetchSitemapXml } from "../fetchers/sitemap-fetcher";
import { fetchAgentGuide } from "../fetchers/guide-fetcher";
import { fetchOpenApi } from "../fetchers/openapi-fetcher";
import { fetchMcpDescriptor } from "../fetchers/mcp-fetcher";
import { fetchLlmsTxt } from "../fetchers/llms-txt-fetcher";
import { fetchX402Discovery } from "../fetchers/x402-fetcher";
import { fetchOpenApiStandard } from "../fetchers/openapi-standard-fetcher";
import { fetchSkillFile } from "../fetchers/skill-file-fetcher";
import { fetchAgentsTxt } from "../fetchers/agents-txt-fetcher";
import { fetchWebMcp } from "../fetchers/webmcp-fetcher";
import { fetchLlmsFull } from "../fetchers/llms-full-fetcher";
import { fetchRssFeed } from "../fetchers/rss-feed-fetcher";
import { fetchHeartbeat } from "../fetchers/heartbeat-fetcher";
import { fetchSkillJson } from "../fetchers/skill-json-fetcher";
import { fetchErrorCatalog } from "../fetchers/error-catalog-fetcher";
import { fetchAgentFeeds } from "../fetchers/agent-feeds-fetcher";
import { fetchFavicon } from "../fetchers/favicon-fetcher";
import { fetchPricing } from "../fetchers/pricing-fetcher";
import { fetchApiCatalog } from "../fetchers/api-catalog-fetcher";
import { fetchOauthProtectedResource } from "../fetchers/oauth-protected-resource-fetcher";
import { fetchAuthMd } from "../fetchers/auth-md-fetcher";
import { fetchAgentSkills } from "../fetchers/agent-skills-fetcher";
import { fetchWebBotAuth } from "../fetchers/web-bot-auth-fetcher";
import { fetchAgentCard } from "../fetchers/agent-card-fetcher";
import { fetchAiSitemap } from "../fetchers/ai-sitemap-fetcher";
import { fetchOauthAuthorizationServer } from "../fetchers/oauth-authorization-server-fetcher";
import { fetchLlmPolicy } from "../fetchers/llm-policy-fetcher";
import { snapOrNull } from "./snapshots";
import type { ResourceHandler } from "./types";

/**
 * Simple `fetch → snapOrNull` handlers: the fetcher returns
 * `{ url, status, body, resolvedIp, fetchTime }` and a `null` body maps to a
 * `null` snapshot.
 */
export const simpleHandlers: Record<string, ResourceHandler> = {
  robots: async ({ baseUrl }) => snapOrNull(await fetchRobotsTxt(baseUrl)),
  sitemap: async ({ baseUrl }) => snapOrNull(await fetchSitemapXml(baseUrl)),
  guide: async ({ baseUrl }) => snapOrNull(await fetchAgentGuide(baseUrl)),
  openapi: async ({ baseUrl }) => snapOrNull(await fetchOpenApi(baseUrl)),
  mcp: async ({ baseUrl }) => snapOrNull(await fetchMcpDescriptor(baseUrl)),
  llms: async ({ baseUrl }) => snapOrNull(await fetchLlmsTxt(baseUrl)),
  x402: async ({ baseUrl }) => snapOrNull(await fetchX402Discovery(baseUrl)),
  openapi_standard: async ({ baseUrl }) => snapOrNull(await fetchOpenApiStandard(baseUrl)),
  skill: async ({ baseUrl }) => snapOrNull(await fetchSkillFile(baseUrl)),
  agents_txt: async ({ baseUrl }) => snapOrNull(await fetchAgentsTxt(baseUrl)),
  webmcp: async ({ baseUrl }) => snapOrNull(await fetchWebMcp(baseUrl)),
  llms_full: async ({ baseUrl }) => snapOrNull(await fetchLlmsFull(baseUrl)),
  rss_feed: async ({ baseUrl }) => snapOrNull(await fetchRssFeed(baseUrl)),
  heartbeat: async ({ baseUrl }) => snapOrNull(await fetchHeartbeat(baseUrl)),
  skill_json: async ({ baseUrl }) => snapOrNull(await fetchSkillJson(baseUrl)),
  error_catalog: async ({ baseUrl }) => snapOrNull(await fetchErrorCatalog(baseUrl)),
  agent_feeds: async ({ baseUrl }) => snapOrNull(await fetchAgentFeeds(baseUrl)),
  favicon: async ({ baseUrl }) => snapOrNull(await fetchFavicon(baseUrl)),
  pricing: async ({ baseUrl }) => snapOrNull(await fetchPricing(baseUrl)),
  api_catalog: async ({ baseUrl }) => snapOrNull(await fetchApiCatalog(baseUrl)),
  oauth_protected_resource: async ({ baseUrl }) => snapOrNull(await fetchOauthProtectedResource(baseUrl)),
  auth_md: async ({ baseUrl }) => snapOrNull(await fetchAuthMd(baseUrl)),
  agent_skills: async ({ baseUrl }) => snapOrNull(await fetchAgentSkills(baseUrl)),
  web_bot_auth: async ({ baseUrl }) => snapOrNull(await fetchWebBotAuth(baseUrl)),
  agent_card: async ({ baseUrl }) => snapOrNull(await fetchAgentCard(baseUrl)),
  ai_sitemap: async ({ baseUrl }) => snapOrNull(await fetchAiSitemap(baseUrl)),
  oauth_authorization_server: async ({ baseUrl }) => snapOrNull(await fetchOauthAuthorizationServer(baseUrl)),
  llm_policy: async ({ baseUrl }) => snapOrNull(await fetchLlmPolicy(baseUrl)),
};
