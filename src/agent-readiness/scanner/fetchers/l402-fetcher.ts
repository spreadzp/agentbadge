import { lookup } from "node:dns/promises";
import { isPrivateIp } from "../ssrf/ip-guard";
import { sha256 } from "./robots-fetcher";

export interface L402Attempt {
  status: number;
  headers: Record<string, string>;
  observedAt: string;
}

export interface L402FetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  headers: Record<string, string>;
  /**
   * SLICE-258-5: second probe of the same request (C5/D-258-Q12) — the
   * MPP `WWW-Authenticate: Payment` recipient can rotate per-payment;
   * a single quote can never prove stability. status 0 = transport
   * failure, which the checker treats as unchecked, never mismatch.
   */
  secondAttempt?: L402Attempt;
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface L402FetchOpts {
  /** Test seam: replaces the real SSRF-guarded POST transport. */
  transport?: (url: string) => Promise<RawResponse>;
}

async function postOnce(url: string): Promise<RawResponse> {
  const parsed = new URL(url);

  // SSRF check
  if (process.env.AGENTBADGE_ALLOW_PRIVATE_IPS !== "1" && process.env.AGENTBADGE_ALLOW_PRIVATE_IPS !== "true") {
    const { address } = await lookup(parsed.hostname);
    const ip = address;
    if (isPrivateIp(ip)) {
      return { status: 0, headers: {}, body: "" };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "AgentBadge-Scanner/1.0",
    },
    body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    signal: controller.signal,
  });

  clearTimeout(timer);

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const bodyText = await response.text().catch(() => "");
  return { status: response.status, headers, body: bodyText };
}

/**
 * Fetch L402 challenge from a paid endpoint — twice.
 *
 * Sends POST /passport/request without payment to trigger a 402 response.
 * Captures WWW-Authenticate and Payment-Required headers for L402 rule
 * evaluation. The second identical-context request is the MPP
 * stability probe (SLICE-258-5): its www-authenticate goes into the
 * snapshot under x-agentbadge-probe2-* keys.
 */
export async function fetchL402Challenge(
  baseUrl: string,
  opts: L402FetchOpts = {},
): Promise<L402FetchResult> {
  const url = `${baseUrl}/passport/request`;
  const startTime = Date.now();
  const doPost = opts.transport ?? postOnce;

  let first: RawResponse;
  try {
    first = await doPost(url);
  } catch {
    first = { status: 0, headers: {}, body: "" };
  }

  let second: L402Attempt;
  try {
    const r = await doPost(url);
    second = { status: r.status, headers: r.headers, observedAt: new Date().toISOString() };
  } catch {
    second = { status: 0, headers: {}, observedAt: new Date().toISOString() };
  }

  const bodyText = first.body || null;
  return {
    url,
    status: first.status,
    body: bodyText,
    bodyHash: bodyText ? sha256(bodyText) : null,
    resolvedIp: null,
    fetchTime: Date.now() - startTime,
    headers: first.headers,
    secondAttempt: second,
  };
}
