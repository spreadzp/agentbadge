import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface OauthAuthorizationServerFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  parseError: string | null;
}

export async function fetchOauthAuthorizationServer(
  baseUrl: string,
): Promise<OauthAuthorizationServerFetchResult> {
  const url = `${baseUrl}/.well-known/oauth-authorization-server`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["application/json"],
    });
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
  } catch {
    return {
      url,
      status: 0,
      body: null,
      bodyHash: null,
      resolvedIp: null,
      fetchTime: 0,
      parseError: null,
    };
  }
}
