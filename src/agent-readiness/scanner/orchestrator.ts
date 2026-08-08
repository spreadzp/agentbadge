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
import { fetchOpenApiStandard } from "./fetchers/openapi-standard-fetcher";
import { fetchSkillFile } from "./fetchers/skill-file-fetcher";
import { fetchAgentsTxt } from "./fetchers/agents-txt-fetcher";
import { fetchWebMcp } from "./fetchers/webmcp-fetcher";
import { fetchLlmsFull } from "./fetchers/llms-full-fetcher";
import { fetchRssFeed } from "./fetchers/rss-feed-fetcher";

export interface ScanOptions {
  noCache?: boolean;
  timeout?: number;
  resources?: string[];
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
  const resources = opts?.resources ?? [...DEFAULT_RESOURCES];

  const snapshots: Record<string, ResponseSnapshot | null> = {};

  // Parallel: robots + sitemap + llms + new fetchers
  const parallelResources = resources.filter((r) =>
    ["robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard", "skill", "agents_txt", "webmcp", "llms_full", "rss_feed"].includes(r),
  );
  const sequentialResources = resources.filter((r) =>
    !["robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard", "skill", "agents_txt", "webmcp", "llms_full", "rss_feed"].includes(r),
  );

  await Promise.all(parallelResources.map(async (resource) => {
    const result = await fetchResource(resource, baseUrl, rateLimiter, cache);
    snapshots[resource] = result;
  }));

  // Sequential: guide, openapi, mcp
  for (const resource of sequentialResources) {
    const result = await fetchResource(resource, baseUrl, rateLimiter, cache);
    snapshots[resource] = result;
  }

  return assembleSourceState(domain, snapshots);
}

async function fetchResource(
  resource: string,
  baseUrl: string,
  rateLimiter: ScannerRateLimiter,
  cache: SnapshotCache | null,
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
        resolvedIp: r.resolvedIp, fetchTimeMs: r.fetchTime,
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
  }

  if (snapshot && cache) {
    cache.set(cacheKey, snapshot);
  }

  return snapshot;
}
