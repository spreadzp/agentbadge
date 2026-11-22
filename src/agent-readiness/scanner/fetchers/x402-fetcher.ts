/**
 * `/.well-known/x402.json` discovery + live-402 double-probe (SLICE-258-4).
 *
 * The manifest is a HINT (D-258-Q11): the authoritative quoted payTo
 * comes from a real 402 response. After fetching the manifest we pick
 * paid endpoints it declares (`services[].path`) and double-probe the
 * first one that answers 402 — two identical-context requests
 * (D-258-Q12, C5: bounded timeout, no payments, no signing). Divergent
 * payTo across the two probes is flagged `divergent` (possible
 * per-payment/deposit address — exempt, not mismatch evidence).
 *
 * Probe traffic is SSRF-hardened exactly like safeFetch: DNS pinned via
 * resolveAndPin + fetchPinned, redirects manual. Manifest `services`
 * are hostile input — only same-origin `/`-paths and GET/POST are ever
 * probed.
 */
import { safeFetch } from "../ssrf/safe-fetch";
import { resolveAndPin } from "../ssrf/dns-pin";
import { fetchPinned } from "../ssrf/pinned-fetch";
import { sha256 } from "./robots-fetcher";
import {
  parsePaymentChallengeQuotes,
  mppQuotesDivergent,
  type MppQuote,
} from "./mpp-payment-challenge";

export interface X402ProbeAccept {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  [k: string]: unknown;
}

export interface X402ProbeAttempt {
  /** HTTP status; 0 on transport failure. */
  status: number;
  observedAt: string;
  /** Decoded accepts[] when the 402 carried parseable payment payload, else null. */
  accepts: X402ProbeAccept[] | null;
  /**
   * SLICE-258-5: MPP `WWW-Authenticate: Payment` recipient quotes on the
   * same response — a mixed-protocol endpoint advertises both rails in
   * one challenge block, no extra traffic needed.
   */
  mppQuotes?: MppQuote[];
}

export interface X402DoubleProbe {
  endpoint: string;
  method: "GET" | "POST";
  attempts: X402ProbeAttempt[];
  /** Second probe quoted a different payTo set → possible per-payment address. */
  divergent: boolean;
  /** Same, over the MPP recipient sets (AB-189). */
  mppDivergent: boolean;
}

export interface X402FetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  /** Parsed manifest doc (null when absent/unparseable). */
  manifest: unknown | null;
  /** Double-probe results — at most one endpoint in v1. */
  probes: X402DoubleProbe[];
}

export type ProbeFn = (
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
) => Promise<X402ProbeAttempt>;

const PROBE_TIMEOUT_MS = 8_000;
const MAX_PROBE_CANDIDATES = 3;

// ─── Manifest → probe candidates ────────────────────────────────────────────

/**
 * Paid endpoints declared by the manifest. Only same-origin absolute
 * paths (`/x`) — a manifest is untrusted content and must never steer
 * the scanner to another origin. GET/POST only; default GET.
 */
export function pickProbeCandidates(manifest: unknown): { path: string; method: "GET" | "POST" }[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const services = (manifest as Record<string, unknown>).services;
  if (!Array.isArray(services)) return [];

  const seen = new Set<string>();
  const out: { path: string; method: "GET" | "POST" }[] = [];
  for (const s of services) {
    if (out.length >= MAX_PROBE_CANDIDATES) break;
    if (typeof s !== "object" || s === null) continue;
    const path = (s as Record<string, unknown>).path;
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) continue;
    const rawMethod = (s as Record<string, unknown>).method;
    const method = typeof rawMethod === "string" ? rawMethod.toUpperCase() : "GET";
    if (method !== "GET" && method !== "POST") continue;
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, method });
  }
  return out;
}

// ─── 402 → accepts[] decoding ───────────────────────────────────────────────

function decodeB64Json(b64: string): unknown | null {
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

function acceptsOf(doc: unknown): X402ProbeAccept[] | null {
  if (typeof doc !== "object" || doc === null) return null;
  const a = (doc as Record<string, unknown>).accepts;
  return Array.isArray(a) && a.length > 0 ? (a as X402ProbeAccept[]) : null;
}

/**
 * Extract `accepts[]` from a 402 response: `payment-required` header
 * (base64 JSON), `www-authenticate: Payment request="<b64>"`, or a JSON
 * body carrying `accepts` (x402 v1 shape).
 */
export function acceptsFromPaymentPayload(
  headers: Record<string, string>,
  bodyText: string | null,
): X402ProbeAccept[] | null {
  const pr = headers["payment-required"];
  if (pr) {
    const found = acceptsOf(decodeB64Json(pr));
    if (found) return found;
  }
  const wwwAuth = headers["www-authenticate"];
  const m = wwwAuth?.match(/request="([^"]+)"/);
  if (m) {
    const found = acceptsOf(decodeB64Json(m[1]));
    if (found) return found;
  }
  if (bodyText) {
    try {
      const found = acceptsOf(JSON.parse(bodyText));
      if (found) return found;
    } catch {
      /* body not JSON */
    }
  }
  return null;
}

// ─── Probe transport ────────────────────────────────────────────────────────

async function probeOnce(baseUrl: string, path: string, method: "GET" | "POST"): Promise<X402ProbeAttempt> {
  const url = `${baseUrl}${path}`;
  const observedAt = new Date().toISOString();
  try {
    const { ip } = await resolveAndPin(new URL(url).hostname);
    const response = await fetchPinned(url, ip, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const bodyText = await response.text().catch(() => "");
    return {
      status: response.status,
      observedAt,
      accepts: response.status === 402 ? acceptsFromPaymentPayload(headers, bodyText) : null,
      mppQuotes:
        response.status === 402
          ? parsePaymentChallengeQuotes(headers["www-authenticate"])
          : [],
    };
  } catch {
    return { status: 0, observedAt, accepts: null, mppQuotes: [] };
  }
}

// ─── Divergence ─────────────────────────────────────────────────────────────

function payToKey(a: X402ProbeAccept): string | null {
  if (typeof a.payTo !== "string" || !a.payTo) return null;
  // EVM addresses compare case-insensitive; everything else verbatim.
  const t = a.payTo.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? t.toLowerCase() : t;
}

function payToSet(accepts: X402ProbeAccept[] | null): Set<string> {
  const s = new Set<string>();
  for (const a of accepts ?? []) {
    const k = payToKey(a);
    if (k) s.add(k);
  }
  return s;
}

/** Two probes quoted different payTo sets → possible per-payment addressing. */
export function probePayTosDivergent(a: X402ProbeAttempt, b: X402ProbeAttempt): boolean {
  const sa = payToSet(a.accepts);
  const sb = payToSet(b.accepts);
  if (sa.size === 0 || sb.size === 0) return false;
  if (sa.size !== sb.size) return true;
  for (const k of sa) if (!sb.has(k)) return true;
  return false;
}

// ─── Main fetcher ───────────────────────────────────────────────────────────

export interface X402DiscoveryOpts {
  /** Test seam: replaces the real pinned probe transport. */
  probeFn?: ProbeFn;
  /** Test seam: skips the manifest fetch, supplies the result directly. */
  manifestResult?: { status: number; body: string | null; resolvedIp: string | null };
}

export async function fetchX402Discovery(
  baseUrl: string,
  opts: X402DiscoveryOpts = {},
): Promise<X402FetchResult> {
  const url = `${baseUrl}/.well-known/x402.json`;
  const start = Date.now();
  const empty = {
    manifest: null,
    probes: [] as X402DoubleProbe[],
  };

  let status = 0;
  let bodyText: string | null = null;
  let resolvedIp: string | null = null;
  try {
    if (opts.manifestResult) {
      status = opts.manifestResult.status;
      bodyText = opts.manifestResult.body;
      resolvedIp = opts.manifestResult.resolvedIp;
    } else {
      const result = await safeFetch(url, {
        allowedContentTypes: ["application/json", "application/json; charset=utf-8"],
      });
      status = result.status;
      bodyText = result.bodyText;
      resolvedIp = result.resolvedIp;
    }
  } catch {
    return { url, status: 0, body: null, bodyHash: null, resolvedIp: null, fetchTime: 0, ...empty };
  }

  let manifest: unknown = null;
  if (bodyText) {
    try {
      manifest = JSON.parse(bodyText);
    } catch {
      manifest = null;
    }
  }

  const probes: X402DoubleProbe[] = [];
  if (manifest !== null) {
    const doProbe = opts.probeFn ?? probeOnce;
    for (const { path, method } of pickProbeCandidates(manifest)) {
      const first = await doProbe(baseUrl, path, method);
      if (first.status !== 402) continue;
      const second = await doProbe(baseUrl, path, method);
      probes.push({
        endpoint: path,
        method,
        attempts: [first, second],
        divergent: probePayTosDivergent(first, second),
        mppDivergent: mppQuotesDivergent(first.mppQuotes, second.mppQuotes),
      });
      break; // D-258-Q12: two probes on ONE endpoint
    }
  }

  return {
    url,
    status,
    body: bodyText,
    bodyHash: bodyText ? sha256(bodyText) : null,
    resolvedIp,
    fetchTime: Date.now() - start,
    manifest,
    probes,
  };
}
