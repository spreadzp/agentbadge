/**
 * Fetches `/.well-known/x402-payto.json` — the weaker tier of the
 * x402 payout-proof spec (DNS proof takes precedence; this file is
 * only consulted when no DNS proof exists, enforced by the rule's
 * semantic checker).
 *
 * Spec constraints (SLICE-258-3):
 * - NO redirects (maxRedirects: 0) — a redirected proof file is not
 *   a proof for this origin
 * - 64 KiB body cap, JSON content type
 * - bounded entry count enforced at parse time (checker side)
 * - transport errors => body null / status 0 — the checker maps
 *   that to "unchecked", never "absent"
 */
import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export const PAYTO_WELLKNOWN_PATH = "/.well-known/x402-payto.json";
const MAX_BODY = 64 * 1024;

export interface PayToWellknownFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchPayToWellknown(
  baseUrl: string,
): Promise<PayToWellknownFetchResult> {
  const url = `${baseUrl}${PAYTO_WELLKNOWN_PATH}`;
  try {
    const result = await safeFetch(url, {
      maxRedirects: 0,
      maxResponseSize: MAX_BODY,
      allowedContentTypes: [
        "application/json",
        "application/json; charset=utf-8",
      ],
    });
    return {
      url,
      status: result.status,
      body: result.bodyText,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch {
    return { url, status: 0, body: null, bodyHash: null, resolvedIp: null, fetchTime: 0 };
  }
}
