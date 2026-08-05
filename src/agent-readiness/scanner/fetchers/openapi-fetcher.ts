import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface OpenApiFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  path: string | null;
  format: "json" | "yaml" | null;
}

const PROBE_PATHS: readonly { path: string; format: "json" | "yaml" }[] = [
  { path: "/openapi.json", format: "json" },
  { path: "/openapi.yaml", format: "yaml" },
  { path: "/swagger.json", format: "json" },
  { path: "/swagger/v1/swagger.json", format: "json" },
];

export async function fetchOpenApi(baseUrl: string): Promise<OpenApiFetchResult> {
  for (const { path, format } of PROBE_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const result = await safeFetch(url, {
        allowedContentTypes: format === "json"
          ? ["application/json"]
          : ["application/yaml", "text/yaml", "text/plain"],
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
          format,
        };
      }
      // 404 or 5xx: continue to next path
      continue;
    } catch {
      continue;
    }
  }
  return {
    url: `${baseUrl}/openapi.json`,
    status: 404,
    body: null,
    bodyHash: null,
    resolvedIp: null,
    fetchTime: 0,
    path: null,
    format: null,
  };
}
