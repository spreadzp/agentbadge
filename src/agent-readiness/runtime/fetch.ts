/**
 * SLICE-98-2: runtimeFetch — thin wrapper over the SSRF suite
 *
 * All runtime HTTP goes through safe-fetch (ip-guard + dns-pin + pinned-fetch).
 * No bypass path. Redaction applied to response headers automatically.
 */

import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "../scanner/ssrf/safe-fetch";
import { redactHeaders } from "./redact";

export interface RuntimeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
  bodyText: string;
  resolvedIp: string;
  fetchTime: number;
  redirectChain: string[];
}

export async function runtimeFetch(
  url: string,
  opts?: SafeFetchOptions,
): Promise<RuntimeFetchResult> {
  const result: SafeFetchResult = await safeFetch(url, opts);
  return {
    ...result,
    headers: redactHeaders(result.headers),
  };
}
