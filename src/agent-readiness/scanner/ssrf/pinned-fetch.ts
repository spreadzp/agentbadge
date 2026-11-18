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
 * - TLS SNI/cert validation uses the original hostname
 * - Port is preserved
 *
 * Runtime split: Bun's fetch accepts `tls.servername`; Node's fetch
 * (undici) ignores it, so vitest workers and the npm CLI use the
 * node:http/https path below instead.
 */
// Native fetch captured at module load — if a host or test swaps
// globalThis.fetch afterwards (vi.stubGlobal), the swap IS the transport.
// The replacement receives the same call the real transport would make:
// the IP-pinned URL plus the original hostname in the Host header.
const nativeFetch = globalThis.fetch;

export async function fetchPinned(
  url: string,
  ip: string,
  opts?: FetchPinnedOptions,
): Promise<Response> {
  if (globalThis.fetch !== nativeFetch) {
    const parsed = new URL(url);
    const portPart = parsed.port ? `:${parsed.port}` : "";
    const pinnedUrl = `${parsed.protocol}//${ip}${portPart}${parsed.pathname}${parsed.search}`;
    return globalThis.fetch(pinnedUrl, {
      method: opts?.method ?? "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Host: parsed.hostname,
        ...opts?.headers,
      },
      signal: opts?.signal ?? null,
      redirect: opts?.redirect ?? "manual",
      // Mirrors fetchPinnedBun: SNI stays on the original hostname
      ...(parsed.protocol === "https:"
        ? { tls: { servername: parsed.hostname } }
        : {}),
    } as RequestInit);
  }
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    return fetchPinnedBun(url, ip, opts);
  }
  return fetchPinnedNode(url, ip, opts);
}

async function fetchPinnedBun(
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

/**
 * Node path: connect to the pinned IP while TLS SNI + cert validation
 * still use the original hostname (https.request `servername`).
 * The result is wrapped into a web `Response` for the caller.
 */
async function fetchPinnedNode(
  url: string,
  ip: string,
  opts?: FetchPinnedOptions,
): Promise<Response> {
  const { request: httpsRequest } = await import("node:https");
  const { request: httpRequest } = await import("node:http");
  const { Readable } = await import("node:stream");

  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;
  const hostname = parsed.hostname;
  const request = isHttps ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const req = request(
      {
        host: ip,
        port,
        path: `${parsed.pathname}${parsed.search}`,
        method: opts?.method ?? "GET",
        servername: isHttps ? hostname : undefined,
        setHost: false,
        headers: {
          Host: hostname,
          "User-Agent": USER_AGENT,
          ...opts?.headers,
        },
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) {
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
        }
        const body = Readable.toWeb(res) as ReadableStream;
        resolve(
          new Response(body, {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            headers,
          }),
        );
      },
    );
    req.on("error", reject);
    const signal = opts?.signal;
    if (signal) {
      const onAbort = () =>
        req.destroy(new DOMException("This operation was aborted", "AbortError"));
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    req.end();
  });
}
