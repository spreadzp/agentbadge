/**
 * Passport-chain config section (EPIC-169, SLICE-169-9 — Hedera diet).
 * Optional — only loaded when PASSPORT_CHAIN_ENABLED=true.
 * When absent, Hedera chain call-sites (NFT mint, DID, verify, cache
 * rebuild, x402 Hedera gate) must not load chain modules at all —
 * they answer 501 instead of pulling @agentbadge/hedera-core/@x402.
 */

import type { PassportChainEnvConfig } from "./types";
import { booleanFlag } from "./validators";

export function loadPassportChain(
  _errors: string[],
): PassportChainEnvConfig | undefined {
  if (!booleanFlag("PASSPORT_CHAIN_ENABLED")) return undefined;
  return { enabled: true };
}
