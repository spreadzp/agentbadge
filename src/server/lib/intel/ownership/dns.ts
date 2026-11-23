// EPIC-262 (SLICE-262-8): domain_control verification via DNS TXT
// (D-262-Q9). Stateless challenge — the expected token is derived by
// HMAC-SHA256 over (siteId + hostname) keyed by the intel signing
// seed, so there is no challenge store and no expiry bookkeeping:
// the operator publishes the TXT and we compare on verify.
// Domain-separated label prevents confusion with other intel HMACs.

import { createHmac } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";

const DNS_HMAC_LABEL = "agentbadge-intel-dns-verify-v1";
export const DNS_TXT_PREFIX = "agentbadge-verify=";
export const DNS_TXT_NAME = "_agentbadge-verify";

/** Expected TXT value for (site, hostname) — deterministic. */
export function expectedDnsToken(
  key: SigningKey,
  siteId: string,
  hostname: string,
): string {
  const mac = createHmac("sha256", Buffer.from(key.privateKey))
    .update(`${DNS_HMAC_LABEL}|${siteId}|${hostname}`)
    .digest("base64url");
  return `${DNS_TXT_PREFIX}${mac}`;
}

/** All TXT record strings for a hostname (chunks flattened). */
export type DnsResolver = (hostname: string) => Promise<string[]>;

export function createNodeDnsResolver(): DnsResolver {
  return async (hostname) => {
    try {
      const records = await resolveTxt(hostname);
      return records.map((chunks) => chunks.join(""));
    } catch {
      return [];
    }
  };
}

/** true when any TXT record on hostname equals the expected value. */
export async function dnsTxtMatch(
  resolver: DnsResolver,
  hostname: string,
  expected: string,
): Promise<boolean> {
  const records = await resolver(hostname);
  return records.some((r) => r.trim() === expected);
}

export const DNS_REVERIFY_DAYS = 90; // D-262-Q9 orientir
