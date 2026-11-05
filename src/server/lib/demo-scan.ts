/**
 * SLICE-206-15 (EPIC-206): demo micro-paywall scan — $0.001 "try us".
 * GET /api/v1/demo/scan-lite?url= is x402-gated at DEMO_SCAN_USDC
 * (atomic, default 1000 = $0.001); returns og/meta + agent-signals.
 * Price is exported from here so the ServiceSku registry can't drift
 * (206-9 SoT).
 *
 * SSRF guard (post-audit): http(s) public hosts only — URL() itself
 * normalizes numeric v4 literals; trailing-dot, IPv6-mapped, CGNAT and
 * private ranges rejected; DNS resolved+checked before every hop;
 * redirects followed MANUALLY (≤3, each re-validated); body stream-read
 * with a hard cap. Residual (accepted): last-mile DNS TOCTOU — the
 * standard guard short of a connect-time proxy.
 */
import { lookup } from "node:dns/promises";

const ATOMIC_PER_USD = 1_000_000;

/** Canonical demo price, USD decimal string ("0.001"). Source: env
 *  DEMO_SCAN_USDC in USDC atomic units (6 decimals). */
export function demoScanPriceUsd(): string {
  const atomic = Number(process.env.DEMO_SCAN_USDC ?? "1000");
  if (!Number.isFinite(atomic) || atomic <= 0) return "0.001";
  const usd = atomic / ATOMIC_PER_USD;
  return usd.toFixed(6).replace(/\.?0+$/, "");
}

/** "$0.001" — the form paymentForPrice expects. */
export function demoScanPriceTag(): string {
  return `$${demoScanPriceUsd()}`;
}

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

const defaultLookup: DnsLookupFn = async (host) =>
  (await lookup(host, { all: true, verbatim: true })) as { address: string }[];

/** Resolve hostname → all A/AAAA private → reject. IP literals and
 *  already-blocked names skip DNS entirely. */
async function dnsGuard(
  url: URL,
  lookupFn: DnsLookupFn,
): Promise<ScanLiteReject | null> {
  const host = url.hostname.replace(/\.$/, "");
  if (isPrivateAddress(host) || BLOCKED_HOSTNAMES.some((re) => re.test(host))) {
    return "blocked_host";
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    return null; // literal IP — nothing to resolve, already checked
  }
  try {
    const addrs = await lookupFn(host);
    if (addrs.length === 0) return "fetch_failed";
    if (addrs.some((a) => isPrivateAddress(a.address))) return "dns_private";
  } catch {
    return "fetch_failed";
  }
  return null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const UA = "AgentBadge-ScanLite/1.0 (+https://agentbadge.xyz)";

/** Stream-read body up to byteCap — no full-body memory spike. */
async function readCappedBody(res: Response, byteCap: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = byteCap - total;
      if (room <= 0) break;
      chunks.push(value.byteLength > room ? value.slice(0, room) : value);
      total += Math.min(value.byteLength, room);
      if (total >= byteCap) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(
    Uint8Array.from(chunks.flatMap((c) => Array.from(c))),
  );
}

export interface ScanLiteResult {
  url: string;
  status: number;
  fetched_bytes: number;
  title: string | null;
  og: { title: string | null; description: string | null; site_name: string | null };
  signals: {
    has_llms_txt_link: boolean;
    has_json_ld: boolean;
    robots_noai: boolean;
    has_agents_txt_link: boolean;
    content_negotiation_hint: boolean;
  };
  agent_ready_hint: "likely" | "partial" | "no-signals";
}

function metaContent(html: string, key: string): string | null {
  const m1 = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
  );
  if (m1) return m1[1];
  const m2 = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  );
  return m2 ? m2[1] : null;
}

export interface ScanLiteDeps {
  fetchFn?: typeof fetch;
  lookupFn?: DnsLookupFn;
}

/** Fetch with manual redirect following — every hop re-runs
 *  validateTarget + dnsGuard so a redirect can't bounce to metadata. */
async function fetchGuarded(
  initial: URL,
  deps: ScanLiteDeps,
): Promise<Response | ScanLiteReject> {
  const fetchFn = deps.fetchFn ?? fetch;
  const lookupFn = deps.lookupFn ?? defaultLookup;
  let url = initial;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const dnsVerdict = await dnsGuard(url, lookupFn);
    if (dnsVerdict) return dnsVerdict;

    let res: Response;
    try {
      res = await fetchFn(url.toString(), {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return "fetch_failed";
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) return "fetch_failed";
      let next: URL | ScanLiteReject;
      try {
        next = validateTarget(new URL(loc, url).toString());
      } catch {
        return "invalid_url";
      }
      if (!(next instanceof URL)) return next;
      url = next;
      continue;
    }
    return res;
  }
  return "too_many_redirects";
}

/** Fetch + extract. Deps injectable for tests (fetch + DNS lookup). */
export async function runScanLite(
  target: URL,
  deps: ScanLiteDeps = {},
): Promise<ScanLiteResult | ScanLiteReject> {
  const res = await fetchGuarded(target, deps);
  if (!(res instanceof Response)) return res;

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html") && !ct.includes("text")) {
    await res.body?.cancel().catch(() => undefined);
    return "not_html";
  }

  const html = await readCappedBody(res, MAX_BYTES);

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const robots = metaContent(html, "robots") ?? "";
  const hasLlms = /<link[^>]+rel=["'][^"']*llms/i.test(html) ||
    /<link[^>]+href=["'][^"']*llms\.txt["']/i.test(html);
  const hasAgents = /<link[^>]+href=["'][^"']*agents\.txt["']/i.test(html);
  const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
  const mdHint = /content[- ]negotiation|text\/markdown/i.test(html);

  const score =
    (hasLlms ? 2 : 0) + (hasJsonLd ? 1 : 0) + (mdHint ? 1 : 0);
  const hint: ScanLiteResult["agent_ready_hint"] =
    score >= 3 ? "likely" : score >= 1 ? "partial" : "no-signals";

  return {
    url: target.toString(),
    status: res.status,
    fetched_bytes: html.length,
    title: titleMatch ? titleMatch[1].trim() : null,
    og: {
      title: metaContent(html, "og:title"),
      description: metaContent(html, "og:description"),
      site_name: metaContent(html, "og:site_name"),
    },
    signals: {
      has_llms_txt_link: hasLlms,
      has_json_ld: hasJsonLd,
      robots_noai: /noai|noimageai/i.test(robots),
      has_agents_txt_link: hasAgents,
      content_negotiation_hint: mdHint,
    },
    agent_ready_hint: hint,
  };
}
