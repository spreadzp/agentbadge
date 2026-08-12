import { lookup } from "node:dns/promises";
import { isPrivateIp } from "../ssrf/ip-guard";
import { sha256 } from "./robots-fetcher";

export interface L402FetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
  headers: Record<string, string>;
}

/**
 * Fetch L402 challenge from a paid endpoint.
 *
 * Sends POST /passport/request without payment to trigger a 402 response.
 * Captures WWW-Authenticate and Payment-Required headers for L402 rule evaluation.
 */
export async function fetchL402Challenge(baseUrl: string): Promise<L402FetchResult> {
  const url = `${baseUrl}/passport/request`;
  const startTime = Date.now();

  try {
    const parsed = new URL(url);

    // SSRF check
    if (process.env.AGENTBADGE_ALLOW_PRIVATE_IPS !== "1" && process.env.AGENTBADGE_ALLOW_PRIVATE_IPS !== "true") {
      const { address } = await lookup(parsed.hostname);
      const ip = address;
      if (isPrivateIp(ip)) {
        return { url, status: 0, body: null, bodyHash: null, resolvedIp: null, fetchTime: 0, headers: {} };
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

    return {
      url,
      status: response.status,
      body: bodyText || null,
      bodyHash: bodyText ? sha256(bodyText) : null,
      resolvedIp: null,
      fetchTime: Date.now() - startTime,
      headers,
    };
  } catch {
    return { url, status: 0, body: null, bodyHash: null, resolvedIp: null, fetchTime: 0, headers: {} };
  }
}
