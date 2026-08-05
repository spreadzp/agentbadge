import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface GuideFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  path: string | null;
}

const PROBE_PATHS = [
  "/.well-known/agent-guide.json",
  "/agent-guide.json",
] as const;

export async function fetchAgentGuide(baseUrl: string): Promise<GuideFetchResult> {
  for (const path of PROBE_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const result = await safeFetch(url, {
        allowedContentTypes: ["application/json"],
      });
      if (result.status === 200) {
        return {
          url,
          status: 200,
          body: result.bodyText,
          bodyHash: sha256(result.body),
          resolvedIp: result.resolvedIp,
          fetchTime: result.fetchTime,
          path,
        };
      }
      if (result.status === 404) continue;
      // 5xx: stop and return
      return {
        url,
        status: result.status,
        body: null,
        bodyHash: null,
        resolvedIp: result.resolvedIp,
        fetchTime: result.fetchTime,
        path: null,
      };
    } catch {
      continue;
    }
  }
  return {
    url: `${baseUrl}${PROBE_PATHS[0]}`,
    status: 404,
    body: null,
    bodyHash: null,
    resolvedIp: null,
    fetchTime: 0,
    path: null,
  };
}
