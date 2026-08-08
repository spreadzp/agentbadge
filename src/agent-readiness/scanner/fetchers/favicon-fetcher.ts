import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface FaviconFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchFavicon(baseUrl: string): Promise<FaviconFetchResult> {
  const url = `${baseUrl}/favicon.svg`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"],
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
