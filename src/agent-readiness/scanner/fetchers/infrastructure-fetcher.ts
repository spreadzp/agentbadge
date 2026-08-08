export interface InfrastructureResult {
  source: "infrastructure";
  data: {
    httpsRedirect: boolean;
    cacheHeaders: boolean;
    structuredErrors: boolean;
    rateLimitHeaders: boolean;
  };
}

type FetchFn = typeof fetch;

export async function fetchInfrastructure(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<InfrastructureResult> {
  const _fetch = fetchFn ?? fetch;
  const httpsUrl = baseUrl.replace(/^https:\/\//, "http://");

  // 1. HTTPS redirect check
  let httpsRedirect = false;
  try {
    const resp = await _fetch(httpsUrl, { redirect: "manual" });
    if (resp.status === 301 || resp.status === 302) {
      const location = resp.headers.get("location") ?? "";
      httpsRedirect = location.startsWith("https://");
    }
  } catch {
    // connection refused or error — still false
  }

  // 2. Cache headers check
  let cacheHeaders = false;
  try {
    const resp = await _fetch(baseUrl);
    const cc = resp.headers.get("cache-control");
    const etag = resp.headers.get("etag");
    const lastMod = resp.headers.get("last-modified");
    cacheHeaders = !!(cc || etag || lastMod);
  } catch {
    // keep false
  }

  // 3. Structured 404 check
  let structuredErrors = false;
  try {
    const resp = await _fetch(`${baseUrl}/nonexistent-test-path-404`);
    if (resp.status === 404) {
      const ct = resp.headers.get("content-type") ?? "";
      structuredErrors = ct.includes("application/json");
    }
  } catch {
    // keep false
  }

  // 4. Rate limit headers check
  let rateLimitHeaders = false;
  try {
    const resp = await _fetch(`${baseUrl}/nonexistent-test-path-404`);
    const limit = resp.headers.get("x-ratelimit-limit");
    const remaining = resp.headers.get("x-ratelimit-remaining");
    const retryAfter = resp.headers.get("retry-after");
    rateLimitHeaders = !!(limit || remaining || retryAfter);
  } catch {
    // keep false
  }

  return {
    source: "infrastructure",
    data: { httpsRedirect, cacheHeaders, structuredErrors, rateLimitHeaders },
  };
}
