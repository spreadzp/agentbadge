import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface AgentFeedsFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  path: string | null;
  feedType: "json" | "rss" | null;
}

const JSON_PATHS = [
  "/agents.json",
  "/jobs.json",
  "/market/tasks.json",
  "/feed.json",
] as const;

const RSS_PATHS = [
  "/agents.rss",
  "/jobs.rss",
  "/market/tasks.rss",
  "/feed.rss",
] as const;

export async function fetchAgentFeeds(baseUrl: string): Promise<AgentFeedsFetchResult> {
  // Try JSON feed paths first
  for (const path of JSON_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const result = await safeFetch(url, {
        allowedContentTypes: ["application/json", "application/json; charset=utf-8", "text/plain"],
      });
      if (result.status === 200 && result.bodyText) {
        return {
          url, status: 200, body: result.bodyText,
          bodyHash: sha256(result.body), resolvedIp: result.resolvedIp,
          fetchTime: result.fetchTime, path, feedType: "json",
        };
      }
      if (result.status === 404) continue;
    } catch { continue; }
  }

  // Try RSS feed paths
  for (const path of RSS_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const result = await safeFetch(url, {
        allowedContentTypes: ["application/rss+xml", "application/xml", "text/xml", "text/plain"],
      });
      if (result.status === 200 && result.bodyText) {
        return {
          url, status: 200, body: result.bodyText,
          bodyHash: sha256(result.body), resolvedIp: result.resolvedIp,
          fetchTime: result.fetchTime, path, feedType: "rss",
        };
      }
      if (result.status === 404) continue;
    } catch { continue; }
  }

  return {
    url: `${baseUrl}${JSON_PATHS[0]}`,
    status: 404,
    body: "",
    bodyHash: null,
    resolvedIp: null,
    fetchTime: 0,
    path: null,
    feedType: null,
  };
}
