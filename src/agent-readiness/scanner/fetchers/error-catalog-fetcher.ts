import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface ErrorCatalogFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  path: string | null;
}

const PROBE_PATHS = [
  "/api/meta/errors",
  "/api/v1/meta/errors",
  "/errors.json",
  "/api/errors",
] as const;

export async function fetchErrorCatalog(baseUrl: string): Promise<ErrorCatalogFetchResult> {
  for (const path of PROBE_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const result = await safeFetch(url, {
        allowedContentTypes: ["application/json", "application/json; charset=utf-8"],
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
  // Per decisions.md: return non-null body "" so snapshot exists → checker absent → GAP
  return {
    url: `${baseUrl}${PROBE_PATHS[0]}`,
    status: 404,
    body: "",
    bodyHash: null,
    resolvedIp: null,
    fetchTime: 0,
    path: null,
  };
}
