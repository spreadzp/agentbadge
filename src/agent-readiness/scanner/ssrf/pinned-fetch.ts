/**
 * SLICE-85-1: IP-Pinned Transport
 *
 * Rewrites the URL to use the validated IP address so Bun's fetch
 * connects to the pinned IP, not a re-resolved hostname.
 * Preserves Host header and TLS SNI for virtual hosting / cert validation.
 */

const USER_AGENT = "AgentBadge/0.1 (+https://agentbadge.dev)";

export interface FetchPinnedOptions {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  redirect?: "manual" | "follow" | "error";
}

/**
 * Fetch a URL using a pre-validated IP address for the TCP connection.
 *
 * - URL hostname is replaced with the pinned IP
 * - Host header is set to the original hostname
 * - tls.servername is set for HTTPS SNI/cert validation
 * - Port is preserved
 */
export async function fetchPinned(
  url: string,
  ip: string,
  opts?: FetchPinnedOptions,
): Promise<Response> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const port = parsed.port;
  const hostname = parsed.hostname;

  // Build the pinned URL: scheme://ip:port/path?query
  const portPart = port ? `:${port}` : "";
  const pinnedUrl = `${parsed.protocol}//${ip}${portPart}${parsed.pathname}${parsed.search}`;

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Host: hostname,
    ...opts?.headers,
  };

  const fetchOpts: Record<string, unknown> = {
    method: opts?.method ?? "GET",
    redirect: opts?.redirect ?? "manual",
    headers,
  };

  if (opts?.signal) {
    fetchOpts.signal = opts.signal;
  }

  // For HTTPS, set tls.servername so SNI and cert validation use the original hostname
  if (isHttps) {
    fetchOpts.tls = { servername: hostname };
  }

  return fetch(pinnedUrl, fetchOpts as RequestInit);
}
