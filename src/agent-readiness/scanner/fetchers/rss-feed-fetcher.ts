import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface RssFeedFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchRssFeed(baseUrl: string): Promise<RssFeedFetchResult> {
  const url = `${baseUrl}/feed`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["application/rss+xml", "application/xml", "text/xml", "application/atom+xml"],
    });
    return {
      url,
      status: result.status,
      body: result.bodyText,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch {
    return { url, status: 0, body: null, bodyHash: null, resolvedIp: null, fetchTime: 0 };
  }
}
