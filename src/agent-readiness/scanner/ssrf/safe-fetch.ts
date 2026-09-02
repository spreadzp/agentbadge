import { resolveAndPin } from "./dns-pin";
import { assertSafeIp } from "./ip-guard";
import { fetchPinned } from "./pinned-fetch";
import {
  ScannerError,
  ScannerErrorCodes,
  SsrfRedirectError,
  RedirectLimitError,
  RedirectLoopError,
  TimeoutError,
  ResponseTooLargeError,
  ContentTypeMismatchError,
} from "./scanner-error";

const USER_AGENT = "AgentBadge/0.1 (+https://agentbadge.dev)";

const DEFAULT_OPTS = {
  timeout: { connect: 5_000, total: 15_000 },
  maxRedirects: 3,
  maxResponseSize: 5_242_880,
  allowedContentTypes: [] as string[],
} as const;

export interface SafeFetchOptions {
  timeout?: { connect: number; total: number };
  maxRedirects?: number;
  maxResponseSize?: number;
  allowedContentTypes?: string[];
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
  bodyText: string;
  resolvedIp: string;
  fetchTime: number;
  redirectChain: string[];
}

export async function safeFetch(
  url: string,
  opts?: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const config = {
    timeout: opts?.timeout ?? DEFAULT_OPTS.timeout,
    maxRedirects: opts?.maxRedirects ?? DEFAULT_OPTS.maxRedirects,
    maxResponseSize: opts?.maxResponseSize ?? DEFAULT_OPTS.maxResponseSize,
    allowedContentTypes: opts?.allowedContentTypes ?? DEFAULT_OPTS.allowedContentTypes,
  };

  const startTime = Date.now();
  const redirectChain: string[] = [];
  let currentUrl = url;
  const visited = new Set<string>();

  for (let hop = 0; hop <= config.maxRedirects; hop++) {
    if (visited.has(currentUrl)) {
      throw new RedirectLoopError([...visited, currentUrl]);
    }
    visited.add(currentUrl);

    const parsed = new URL(currentUrl);

    let ip: string;
    if (hop > 0) {
      try {
        const pinned = await resolveAndPin(parsed.hostname);
        ip = pinned.ip;
        assertSafeIp(ip);
      } catch (e) {
        if (e instanceof SsrfRedirectError) throw e;
        const blockedIp = (e as { details?: { ip?: string } }).details?.ip ?? "unknown";
        throw new SsrfRedirectError(currentUrl, blockedIp);
      }
    } else {
      const pinned = await resolveAndPin(parsed.hostname);
      ip = pinned.ip;
    }

    const result = await fetchSingleHop(currentUrl, ip, config);

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers["location"];
      if (!location) throw new ScannerError(ScannerErrorCodes.FETCH_FAILED, `Redirect with no Location header: ${currentUrl}`);

      const redirectUrl = new URL(location, currentUrl).href;
      redirectChain.push(currentUrl);

      if (hop >= config.maxRedirects) {
        throw new RedirectLimitError(config.maxRedirects, [...redirectChain, redirectUrl]);
      }

      currentUrl = redirectUrl;
      continue;
    }

    // Check content-type if configured (only on 2xx)
    if (config.allowedContentTypes.length > 0 && result.status >= 200 && result.status < 300) {
      const ct = result.headers["content-type"] ?? "";
      const ctBase = ct.split(";")[0].trim();
      if (!config.allowedContentTypes.some((allowed) => ctBase === allowed || ct === allowed)) {
        throw new ContentTypeMismatchError(currentUrl, config.allowedContentTypes, ct);
      }
    }

    // Check response size
    if (result.body.byteLength > config.maxResponseSize) {
      throw new ResponseTooLargeError(currentUrl, config.maxResponseSize, result.body.byteLength);
    }

    // Retry once on 5xx
    if (result.status >= 500 && hop === 0 && redirectChain.length === 0) {
      const retryResult = await fetchSingleHop(currentUrl, ip, config);
      return {
        ...retryResult,
        redirectChain,
        fetchTime: Date.now() - startTime,
      };
    }

    return {
      ...result,
      redirectChain,
      fetchTime: Date.now() - startTime,
    };
  }

  throw new RedirectLimitError(config.maxRedirects, redirectChain);
}

async function fetchSingleHop(
  url: string,
  ip: string,
  config: { timeout: { connect: number; total: number }; maxResponseSize: number },
): Promise<Omit<SafeFetchResult, "redirectChain" | "fetchTime">> {
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), config.timeout.total);

  try {
    const response = await fetchPinned(url, ip, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Stream and check size
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.byteLength;
        if (totalSize > config.maxResponseSize) {
          throw new ResponseTooLargeError(url, config.maxResponseSize, totalSize);
        }
        chunks.push(value);
      }
    }

    const body = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      status: response.status,
      headers,
      body: body.buffer,
      bodyText: new TextDecoder().decode(body),
      resolvedIp: ip,
    };
  } catch (e) {
    if (e instanceof ResponseTooLargeError) throw e;
    if (e instanceof ScannerError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new TimeoutError(url, "total");
    }
    throw new ScannerError(
      ScannerErrorCodes.FETCH_FAILED,
      `Fetch failed: ${url} — ${(e as Error).message}`,
      { url, cause: String(e) },
    );
  } finally {
    clearTimeout(totalTimer);
  }
}
