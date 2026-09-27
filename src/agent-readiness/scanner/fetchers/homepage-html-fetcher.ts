import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface HtmlFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

/**
 * Raw homepage HTML for GEO citability rules (EPIC-146): semantic checkers
 * need the initial markup to detect server-rendered content, answer blocks,
 * overlays, and entity signals. Parses nothing — returns the body verbatim.
 */
export async function fetchHomepageHtml(baseUrl: string): Promise<HtmlFetchResult> {
  const url = `${baseUrl}/`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
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
    return {
      url,
      status: 0,
      body: null,
      bodyHash: null,
      resolvedIp: null,
      fetchTime: 0,
    };
  }
}
