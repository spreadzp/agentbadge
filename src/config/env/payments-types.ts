/**
 * Payments API config types (EPIC-221, SLICE-221-2) — extracted from
 * types.ts to keep that file under the 300-line cap.
 */

/** One DIRECT_USDC rail binding — always present only when BOTH fields
 *  configured. Recipient/tokenContract are server-side config ONLY —
 *  never accepted from clients (spec invariant). */
export interface UsdcNetworkConfig {
  recipient: string;
  tokenContract: string;
  /** "arc" | "base" | "solana" — debug label. */
  label: string;
}

export interface PaymentsConfig {
  /** CAIP-2 network tag → server-bound rail config. */
  usdcNetworks: Record<string, UsdcNetworkConfig>;
  /** PAYMENTS_USDC_TTL_SEC — instructions expiry TTL (default 3600). */
  usdcInstructionsTtlSec: number;
}
