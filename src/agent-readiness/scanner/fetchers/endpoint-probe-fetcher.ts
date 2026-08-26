import type { ResponseSnapshot } from "../snapshot";

export interface EndpointProbeConfig {
  maxEndpoints?: number;
}

export interface EndpointProbeEntry {
  path: string;
  method: string;
  responseStatus: number;
  contentType: string | null;
  matchesOpenApi: boolean;
  error?: string;
}

export interface EndpointProbeResult {
  status: "success" | "no_openapi" | "no_safe_endpoints" | "error";
  endpoints: EndpointProbeEntry[];
}

export async function fetchEndpointProbe(
  baseUrl: string,
  openapiSnapshot: ResponseSnapshot | null,
  config?: EndpointProbeConfig,
  fetchFn?: typeof fetch,
): Promise<EndpointProbeResult> {
  if (!openapiSnapshot || !openapiSnapshot.body) {
    return { status: "no_openapi", endpoints: [] };
  }

  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(openapiSnapshot.body);
  } catch {
    return { status: "no_openapi", endpoints: [] };
  }

  const maxEndpoints = config?.maxEndpoints ?? 3;
  const safeEndpoints: Array<{ path: string; method: string }> = [];
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;

  for (const [path, methods] of Object.entries(paths)) {
    if (path.includes("{")) continue;

    for (const [method, def] of Object.entries(methods)) {
      if (method.toLowerCase() !== "get") continue;
      const defObj = def as Record<string, unknown>;
      if (defObj.security && (defObj.security as unknown[]).length > 0) continue;

      safeEndpoints.push({ path, method: "GET" });
      if (safeEndpoints.length >= maxEndpoints) break;
    }
    if (safeEndpoints.length >= maxEndpoints) break;
  }

  if (safeEndpoints.length === 0) {
    return { status: "no_safe_endpoints", endpoints: [] };
  }

  const _fetch = fetchFn ?? fetch;
  const results: EndpointProbeEntry[] = [];

  for (const ep of safeEndpoints) {
    const url = `${baseUrl}${ep.path}`;
    try {
      const resp = await _fetch(url);
      const contentType = resp.headers.get("content-type");
      const expectedStatuses = Object.keys(
        ((paths[ep.path]?.get as Record<string, unknown>)?.responses ?? {}) as Record<string, unknown>,
      );
      const matches =
        expectedStatuses.includes(String(resp.status)) || expectedStatuses.includes("default");
      results.push({
        path: ep.path,
        method: ep.method,
        responseStatus: resp.status,
        contentType,
        matchesOpenApi: matches,
      });
    } catch (e) {
      results.push({
        path: ep.path,
        method: ep.method,
        responseStatus: 0,
        contentType: null,
        matchesOpenApi: false,
        error: (e as Error).message,
      });
    }
  }

  return { status: "success", endpoints: results };
}
