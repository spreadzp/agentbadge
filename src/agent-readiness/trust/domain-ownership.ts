/**
 * SLICE-102-3: Domain ownership orchestrator.
 *
 * Tries DNS TXT first, then well-known file. Returns proof from first success.
 */

import { verifyDnsTxt, type DnsVerificationResult } from "./dns-verifier";
import { verifyWellKnownFile, type WellKnownVerificationResult } from "./well-known-verifier";
import type { Challenge } from "./challenge";
import type { DomainOwnership } from "./trust-schema";

export type DomainOwnershipProof = DnsVerificationResult | WellKnownVerificationResult;

/**
 * Verify domain ownership by trying DNS TXT first, then well-known file.
 *
 * Returns a DomainOwnership object if verification succeeds, null otherwise.
 */
export async function verifyDomainOwnership(
  domain: string,
  challenge: Challenge,
): Promise<DomainOwnership | null> {
  // Try DNS TXT first (faster, more reliable)
  const dnsResult = await verifyDnsTxt(domain, challenge);
  if (dnsResult) {
    return {
      method: "dns_txt",
      verified: true,
      verified_at: dnsResult.verified_at,
      challenge_token: challenge.token,
      proof: dnsResult.proof,
    };
  }

  // Fall back to well-known file
  const wellKnownResult = await verifyWellKnownFile(domain, challenge);
  if (wellKnownResult) {
    return {
      method: "well_known_file",
      verified: true,
      verified_at: wellKnownResult.verified_at,
      challenge_token: challenge.token,
      proof: wellKnownResult.proof,
    };
  }

  return null;
}
