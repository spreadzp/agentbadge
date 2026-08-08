import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface AuthMdFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchAuthMd(baseUrl: string): Promise<AuthMdFetchResult> {
  const url = `${baseUrl}/auth.md`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["text/markdown", "text/plain"],
    });
    return {
      url,
      status: result.status,
      body: result.bodyText,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch (e) {
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
