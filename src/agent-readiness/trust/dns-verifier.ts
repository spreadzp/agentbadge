/**
 * SLICE-102-3: DNS TXT verifier for domain ownership.
 *
 * Queries _agentbadge-verify.<domain> TXT record and matches challenge token.
 */

import { resolveTxt } from "node:dns/promises";
import type { Challenge } from "./challenge";

export interface DnsVerificationResult {
  verified: boolean;
  method: "dns_txt";
  verified_at: string;
  proof: string;
}

/**
 * Verify domain ownership via DNS TXT record.
 *
 * Queries _agentbadge-verify.<domain> for a TXT record matching the challenge token.
 * Returns null on DNS errors, no record, or token mismatch.
 */
export async function verifyDnsTxt(
  domain: string,
  challenge: Challenge,
): Promise<DnsVerificationResult | null> {
  const recordName = `_agentbadge-verify.${domain}`;

  try {
    const records = await resolveTxt(recordName);

    // Flatten TXT record arrays (each record is an array of string fragments)
    const txtValues: string[] = [];
    for (const record of records) {
      txtValues.push(record.join(""));
    }

    // Check if any TXT record matches the challenge token
    const matched = txtValues.find((txt) => txt === challenge.token);

    if (matched) {
      return {
        verified: true,
        method: "dns_txt",
        verified_at: new Date().toISOString(),
        proof: `TXT ${recordName} = ${matched}`,
      };
    }

    return null;
  } catch {
    // DNS errors (NXDOMAIN, SERVFAIL, timeout, etc.) — return null gracefully
    return null;
  }
}
