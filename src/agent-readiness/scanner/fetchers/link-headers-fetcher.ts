import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface LinkHeadersFetchResult {
  url: string;
  status: number;
  linkHeaders: { rel: string; href: string }[];
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchLinkHeaders(baseUrl: string): Promise<LinkHeadersFetchResult> {
  const url = `${baseUrl}/`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
    });
    const linkHeader = result.headers?.["link"] ?? result.headers?.["Link"] ?? "";
    const linkHeaders = parseLinkHeader(linkHeader);
    return {
      url,
      status: result.status,
      linkHeaders,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      linkHeaders: [],
      bodyHash: null,
      resolvedIp: null,
      fetchTime: 0,
    };
  }
}

function parseLinkHeader(header: string): { rel: string; href: string }[] {
  if (!header) return [];
  const links: { rel: string; href: string }[] = [];
  const parts = header.split(",");
  for (const part of parts) {
    const hrefMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/rel="?([^";]+)"?/);
    if (hrefMatch && relMatch) {
      links.push({ href: hrefMatch[1].trim(), rel: relMatch[1].trim() });
    }
  }
  return links;
}
