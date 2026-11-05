/**
 * SLICE-206-15 (EPIC-206): demo micro-paywall scan — $0.001 "try us".
 * GET /api/v1/demo/scan-lite?url= is x402-gated at DEMO_SCAN_USDC
 * (atomic, default 1000 = $0.001); returns og/meta + agent-signals.
 * Price is exported from here so the ServiceSku registry can't drift
 * (206-9 SoT).
 *
 * SSRF guard lives in demo-scan-guard.ts (206-18 lint split): http(s)
 * public hosts only, DNS resolved+checked and PINNED into the
 * connection per hop, redirects followed MANUALLY (≤3, each
 * re-validated), body stream-read with a hard cap, regex surface
 * bounded to <head> (audit round-2).
 */
import {
  defaultLookup,
  pinnedDispatcher,
  resolveAddrs,
  validateTarget,
  type DnsLookupFn,
  type ScanLiteReject,
} from "./demo-scan-guard";

// Back-compat re-exports — existing callers/tests keep importing from
// demo-scan (206-18 module split, 300-line lint cap).
export {
  isPrivateAddress,
  precheckTarget,
  validateTarget,
} from "./demo-scan-guard";
export type {
  DnsLookupFn,
  ScanLitePrecheck,
  ScanLiteReject,
} from "./demo-scan-guard";

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

const HEAD_CAP = 64 * 1024;
/** Bound the regex surface to the <head> region (audit H — quadratic
 *  cost on full-body scans). Head-terminator search is linear; regexes
 *  then run on ≤64KB. */
function headSlice(html: string): string {
  const end = /<\/head\b[^>]*>/i.exec(html);
  const limit = end
    ? Math.min(end.index + end[0].length, HEAD_CAP)
    : HEAD_CAP;
  return html.slice(0, limit);
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
  /** Pre-resolved+validated addresses for the FIRST hop (pre-paywall
   *  precheck stash — the connection pins to them; undefined = resolve
   *  inside, null = literal IP already validated). */
  pinned?: { address: string }[] | null;
}

/** Fetch with manual redirect following — every hop re-runs
 *  validateTarget + resolveAddrs so a redirect can't bounce to metadata. */
async function fetchGuarded(
  initial: URL,
  deps: ScanLiteDeps,
): Promise<Response | ScanLiteReject> {
  const fetchFn = deps.fetchFn ?? fetch;
  const lookupFn = deps.lookupFn;
  let url = initial;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Hop 0 may carry pre-paywall pinned addrs (precharge fix); later
    // hops resolve+pin themselves — every hop re-runs the guard so a
    // redirect can't bounce to a private target.
    let addrs: { address: string }[] | null | undefined =
      hop === 0 ? deps.pinned : undefined;
    if (addrs === undefined) {
      const resolved = await resolveAddrs(url, lookupFn ?? defaultLookup);
      if (typeof resolved === "string") return resolved;
      addrs = resolved.addrs;
    }
    const pin = addrs?.length ? await pinnedDispatcher(addrs) : {};

    let res: Response;
    try {
      res = await fetchFn(url.toString(), {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...pin,
      } as RequestInit);
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
  // Audit H (regex cost): bound the regex surface to the <head> region
  // — meta/title/link patterns on a full 512KB body measured 11.5s of
  // blocked event loop. All signals we extract live in <head>.
  const head = headSlice(html);

  const titleMatch = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  const robots = metaContent(head, "robots") ?? "";
  const hasLlms = /<link[^>]+rel=["'][^"']*llms/i.test(head) ||
    /<link[^>]+href=["'][^"']*llms\.txt["']/i.test(head);
  const hasAgents = /<link[^>]+href=["'][^"']*agents\.txt["']/i.test(head);
  const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(head);
  const mdHint = /content[- ]negotiation|text\/markdown/i.test(head);

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
      title: metaContent(head, "og:title"),
      description: metaContent(head, "og:description"),
      site_name: metaContent(head, "og:site_name"),
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


