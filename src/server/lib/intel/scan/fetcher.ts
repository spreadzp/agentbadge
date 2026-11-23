// EPIC-262 (SLICE-262-6): injectable scan fetcher — production wraps
// the SSRF-safe safeFetch (resolveAndPin + pinned redirects + size
// caps); tests inject a stub. No rule or runner code touches the
// network directly.
import { safeFetch } from "../../../../agent-readiness/scanner/ssrf/safe-fetch";

export interface ScanObservation {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  resolvedIp: string;
}

export type ScanFetch = (
  url: string,
  userAgent?: string,
) => Promise<ScanObservation>;

export const createSafeScanFetch = (): ScanFetch =>
  async (url, userAgent) => {
    const r = await safeFetch(
      url,
      userAgent ? { userAgent } : undefined,
    );
    return {
      status: r.status,
      headers: r.headers,
      bodyText: r.bodyText,
      resolvedIp: r.resolvedIp,
    };
  };
