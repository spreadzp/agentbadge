/**
 * SLICE-102-3: Well-known file verifier for domain ownership.
 *
 * Fetches /.well-known/agentbadge-verify.txt and matches challenge token.
 * Uses SSRF-safe fetch from scanner.
 */

import { safeFetch } from "../scanner/ssrf/safe-fetch";
import type { Challenge } from "./challenge";

export interface WellKnownVerificationResult {
  verified: boolean;
  method: "well_known_file";
  verified_at: string;
  proof: string;
}

/**
 * Verify domain ownership via well-known file.
 *
 * Fetches https://<domain>/.well-known/agentbadge-verify.txt
 * and checks if the content matches the challenge token.
 * Returns null on HTTP errors, 404, or token mismatch.
 */
export async function verifyWellKnownFile(
  domain: string,
  challenge: Challenge,
): Promise<WellKnownVerificationResult | null> {
  const url = `https://${domain}/.well-known/agentbadge-verify.txt`;

  try {
    const result = await safeFetch(url, {
      timeout: { connect: 5000, total: 10000 },
    });

    if (result.status >= 400) {
      return null;
    }

    const trimmed = result.bodyText.trim();

    if (trimmed === challenge.token) {
      return {
        verified: true,
        method: "well_known_file",
        verified_at: new Date().toISOString(),
        proof: `GET ${url} → 200, body matches challenge token`,
      };
    }

    return null;
  } catch {
    // HTTP errors, timeouts, SSL errors — return null gracefully
    return null;
  }
}
