import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface McpFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  parseError: string | null;
}

export async function fetchMcpDescriptor(baseUrl: string): Promise<McpFetchResult> {
  const url = `${baseUrl}/.well-known/mcp.json`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["application/json"],
    });
    if (result.status === 404) {
      return {
        url,
        status: 404,
        body: null,
        bodyHash: null,
        resolvedIp: result.resolvedIp,
        fetchTime: result.fetchTime,
        parseError: null,
      };
    }
    // Validate JSON
    let parseError: string | null = null;
    try {
      JSON.parse(result.bodyText);
    } catch {
      parseError = "invalid_json";
    }
    return {
      url,
      status: result.status,
      body: result.bodyText,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
      parseError,
    };
  } catch (e) {
    // 5xx or network error
    throw e;
  }
}
