/**
 * SLICE-206-18 (EPIC-206, audit round-2): SSRF/DNS guard for the demo
 * scan-lite endpoint — split out of demo-scan.ts (300-line cap).
 *
 * URL() itself normalizes numeric v4 literals; trailing-dot,
 * IPv6-mapped, CGNAT and private ranges rejected; DNS resolved+checked
 * before every hop; resolved addresses can be PINNED into the fetch
 * connection so the guard's resolution IS the connection's resolution
 * (audit H — DNS rebind/TOCTOU close, best-effort via undici).
 */
import { lookup } from "node:dns/promises";

export type ScanLiteReject =
  | "invalid_url"
  | "blocked_host"
  | "dns_private"
  | "too_many_redirects"
  | "fetch_failed"
  | "not_html";

/** IPv4 → uint32 (post-URL() dotted form), or undefined. */
function ipv4ToInt(dotted: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(dotted);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>>
    0
  );
}

/** RFC-1918 / loopback / link-local / CGNAT / unspecified v4? */
function isPrivateV4(dotted: string): boolean {
  const n = ipv4ToInt(dotted);
  if (n === undefined) return true; // unparseable = treat as blocked
  const a = n >>> 24;
  if (a === 0 || a === 10 || a === 127 || a === 224 || a >= 240) return true;
  if (((n >>> 16) & 0xffff) === 0xa9fe) return true; // 169.254/16
  if ((n >>> 20) === 0xac1) return true; // 172.16/12
  if (((n >>> 16) & 0xffff) === 0xc0a8) return true; // 192.168/16
  if ((n >>> 22) === 0x191) return true; // 100.64/10 CGNAT
  if ((n >>> 17) === 0x6309) return true; // 198.18/15 benchmark
  return false;
}

/** IPv6 guard: loopback, link-local, ULA, unspecified, v4-mapped. */
function isPrivateV6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  // ::ffff:a.b.c.d mapped or hex-tailed — extract v4 tail and check.
  const v4Tail = /::ffff:(?:0x)?[0-9a-f.:]+$/.exec(h);
  if (v4Tail) {
    const tail = v4Tail[0].slice(7);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return isPrivateV4(tail);
    return true; // hex-form mapped v4 — conservative block
  }
  return false;
}

/** Literal/dotted-decimal/IPv6 private check on a resolved address. */
export function isPrivateAddress(addr: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) return isPrivateV4(addr);
  if (addr.includes(":")) return isPrivateV6(addr);
  return false;
}

const BLOCKED_HOSTNAMES: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
];

/** Sync literal-level check — scheme + obvious private hosts. DNS
 *  and redirect hops are enforced separately in runScanLite. */
export function validateTarget(raw: string): ScanLiteReject | URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "invalid_url";
  }
  const host = url.hostname.replace(/\.$/, ""); // "localhost." → localhost
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) return "blocked_host";
  if (isPrivateAddress(host)) return "blocked_host";
  return url;
}

export type DnsLookupFn = (host: string) => Promise<{ address: string }[]>;

export const defaultLookup: DnsLookupFn = async (host) =>
  (await lookup(host, { all: true, verbatim: true })) as { address: string }[];

export type ResolveResult =
  | ScanLiteReject
  | { addrs: { address: string }[] | null };

/** Resolve hostname → all A/AAAA private → reject. IP literals and
 *  already-blocked names skip DNS entirely (addrs:null = validated
 *  literal, nothing to pin). Returns the validated address list so the
 *  connection can be PINNED to it — audit H (DNS rebind/TOCTOU): a
 *  guard that resolves once while fetch re-resolves opens a rebind
 *  window; pinning the resolution into the connection closes it. */
export async function resolveAddrs(
  url: URL,
  lookupFn: DnsLookupFn,
): Promise<ResolveResult> {
  const host = url.hostname.replace(/\.$/, "");
  if (isPrivateAddress(host) || BLOCKED_HOSTNAMES.some((re) => re.test(host))) {
    return "blocked_host";
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    return { addrs: null }; // literal IP — nothing to resolve
  }
  try {
    const addrs = await lookupFn(host);
    if (addrs.length === 0) return "fetch_failed";
    if (addrs.some((a) => isPrivateAddress(a.address))) return "dns_private";
    return { addrs };
  } catch {
    return "fetch_failed";
  }
}

/** Pin a connection to pre-validated addresses (audit H — DNS rebind):
 *  an undici Agent whose lookup returns exactly the addrs the guard
 *  already checked — the socket never re-resolves. Best-effort: where
 *  undici/`dispatcher` is unavailable the validation still applies.
 *  Residual: runtimes ignoring `dispatcher` keep the last-mile window. */
export async function pinnedDispatcher(
  addrs: { address: string }[],
): Promise<{ dispatcher?: unknown }> {
  try {
    const { Agent } = await import("undici");
    const agent = new Agent({
      connect: {
        lookup: (
          _host: string,
          opts: { all?: boolean } | undefined,
          cb: (err: Error | null, address?: unknown, family?: number) => void,
        ) => {
          const mapped = addrs.map((a) => ({
            address: a.address,
            family: a.address.includes(":") ? 6 : 4,
          }));
          if (opts?.all) cb(null, mapped);
          else cb(null, mapped[0]?.address, mapped[0]?.family);
        },
      } as never,
    });
    return { dispatcher: agent };
  } catch {
    return {};
  }
}

/** Precheck result carried on the Hono context between the
 *  pre-paywall middleware (demo-x402) and the route handler. */
export interface ScanLitePrecheck {
  url: URL;
  addrs: { address: string }[] | null;
}

declare module "hono" {
  interface ContextVariableMap {
    scanLitePrecheck: ScanLitePrecheck;
  }
}

/** Pre-paywall precheck (audit H — charged-on-failure): validate the
 *  URL and resolve+check DNS BEFORE payment runs so an invalid target
 *  is rejected unpaid. Resolved addrs are stashed for the handler,
 *  which pins the connection to them (rebind fix above). */
export async function precheckTarget(
  raw: string,
  lookupFn: DnsLookupFn = defaultLookup,
): Promise<ScanLitePrecheck | ScanLiteReject> {
  const v = validateTarget(raw);
  if (!(v instanceof URL)) return v;
  const r = await resolveAddrs(v, lookupFn);
  if (typeof r === "string") return r;
  return { url: v, addrs: r.addrs };
}
