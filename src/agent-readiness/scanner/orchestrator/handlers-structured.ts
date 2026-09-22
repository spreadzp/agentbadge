import { createSnapshot } from "../snapshot";
import { fetchContentNegotiation } from "../fetchers/content-negotiation-fetcher";
import { fetchL402Challenge } from "../fetchers/l402-fetcher";
import { fetchMcpProbe } from "../fetchers/mcp-probe-fetcher";
import { fetchHomepageMeta } from "../fetchers/homepage-meta-fetcher";
import { fetchInfrastructure } from "../fetchers/infrastructure-fetcher";
import { fetchA2A } from "../fetchers/a2a-fetcher";
import { fetchIdentity } from "../fetchers/identity-fetcher";
import { fetchBotAuth } from "../fetchers/bot-auth-fetcher";
import { fetchLinkHeaders } from "../fetchers/link-headers-fetcher";
import { fetchContentSignals } from "../fetchers/content-signals-fetcher";
import { fetchDnsAid } from "../fetchers/dns-aid-fetcher";
import { fetchWebmcpRuntime } from "../fetchers/webmcp-runtime-fetcher";
import { fetchOgMeta } from "../fetchers/og-meta-fetcher";
import { fetchAeoContent } from "../fetchers/aeo-content-fetcher";
import { fetchSemanticHtml } from "../fetchers/semantic-html-fetcher";
import { fetchAccessibility } from "../fetchers/accessibility-fetcher";
import { fetchContentDepth } from "../fetchers/content-depth-fetcher";
import { fetchAAuth } from "../fetchers/aauth-fetcher";
import { snapJson } from "./snapshots";
import type { ResourceHandler } from "./types";

/**
 * Structured / special handlers: the fetcher returns a JSON-able object (or a
 * result needing headers / custom status), so the snapshot body is
 * `JSON.stringify(r)` rather than the raw HTTP body.
 */
export const structuredHandlers: Record<string, ResourceHandler> = {
  content_negotiation: async ({ baseUrl }) => {
    const r = await fetchContentNegotiation(baseUrl);
    return r.body !== null
      ? createSnapshot({
          url: r.url, status: r.status, body: r.body,
          resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime, headers: r.headers,
        })
      : null;
  },
  mcp_probe: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/mcp`, await fetchMcpProbe(baseUrl)),
  homepage_meta: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/`, await fetchHomepageMeta(baseUrl)),
  infrastructure: async ({ baseUrl }) =>
    snapJson(baseUrl, await fetchInfrastructure(baseUrl)),
  a2a: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/.well-known/agent-card.json`, await fetchA2A(baseUrl)),
  identity: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/.well-known/`, await fetchIdentity(baseUrl)),
  bot_auth: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/.well-known/http-message-signatures-directory`, await fetchBotAuth(baseUrl)),
  link_headers: async ({ baseUrl }) => {
    const r = await fetchLinkHeaders(baseUrl);
    return createSnapshot({
      url: r.url, status: r.status, body: JSON.stringify(r),
      resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
    });
  },
  content_signals: async ({ baseUrl }) => {
    const r = await fetchContentSignals(baseUrl);
    return r.body !== null
      ? createSnapshot({
          url: r.url, status: r.status, body: JSON.stringify(r),
          resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
        })
      : null;
  },
  dns_aid: async ({ baseUrl }) => {
    const domain = new URL(baseUrl).hostname;
    const r = await fetchDnsAid(domain);
    return createSnapshot({
      url: `_agent.${domain}`, status: r.found ? 200 : 404, body: JSON.stringify(r),
      resolvedIp: null, fetchTimeMs: r.fetchTime,
    });
  },
  webmcp_runtime: async ({ baseUrl }) => {
    const r = await fetchWebmcpRuntime(baseUrl);
    return createSnapshot({
      url: r.url, status: r.status, body: JSON.stringify(r),
      resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
    });
  },
  l402: async ({ baseUrl }) => {
    const r = await fetchL402Challenge(baseUrl);
    return createSnapshot({
      url: r.url, status: r.status, body: r.body,
      resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime, headers: r.headers,
    });
  },
  og_meta: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/`, await fetchOgMeta(`${baseUrl}/`)),
  aeo_content: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/`, await fetchAeoContent(`${baseUrl}/`)),
  semantic_html: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/`, await fetchSemanticHtml(`${baseUrl}/`)),
  accessibility: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/`, await fetchAccessibility(`${baseUrl}/`)),
  content_depth: async ({ baseUrl }) =>
    snapJson(`${baseUrl}/`, await fetchContentDepth(`${baseUrl}/`)),
  aauth: async ({ baseUrl }) => {
    const result = await fetchAAuth(baseUrl);
    return createSnapshot({
      url: `${baseUrl}/.well-known/aauth.json`,
      status: result.data.aauthFound ? 200 : 404,
      body: JSON.stringify(result),
      resolvedIp: null,
      fetchTimeMs: 0,
    });
  },
};
