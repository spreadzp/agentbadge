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

/** EPIC-222-3: on-chain USDC monitor — explicit opt-in (D-222-3). */
export interface UsdcMonitorConfig {
  /** USDC_MONITOR_ENABLED === "true" AND arcRpcUrl AND >=1 arc network. */
  enabled: boolean;
  /** ARC_RPC_URL — viem http transport for the Arc adapter. */
  arcRpcUrl?: string;
  /** USDC_MONITOR_INTERVAL_MS — tick cadence (default 30s). */
  intervalMs: number;
  /** USDC_MONITOR_LOOKBACK_BLOCKS — scan window depth (default 4096). */
  lookbackBlocks: number;
}

/** EPIC-222-5: reconciliation sweeper — opt-in like the monitor,
 *  same RPC/network prerequisites (it reads the chain). */
export interface UsdcReconciliationConfig {
  /** USDC_RECONCILIATION_ENABLED === "true" AND arcRpcUrl AND
   *  >=1 arc network. */
  enabled: boolean;
  /** Shared ARC_RPC_URL — recon never opens its own endpoint. */
  arcRpcUrl?: string;
  /** USDC_RECONCILIATION_INTERVAL_MS — tick cadence (default 1h). */
  intervalMs: number;
  /** USDC_RECONCILIATION_LOOKBACK_BLOCKS — first-run scan depth
   *  when no cursor exists (default 4096). */
  lookbackBlocks: number;
}

export interface PaymentsConfig {
  /** CAIP-2 network tag → server-bound rail config. */
  usdcNetworks: Record<string, UsdcNetworkConfig>;
  /** PAYMENTS_USDC_TTL_SEC — instructions expiry TTL (default 3600). */
  usdcInstructionsTtlSec: number;
  /** PAYMENTS_USDC_SELF_SERVE — H-8: the instructions-only stub must be
   *  explicitly opted into; unset/false → DIRECT_USDC provider is not
   *  registered and attempts get provider_unavailable. */
  usdcSelfServeEnabled: boolean;
  /** EPIC-222-3: monitor config; enabled=false → no timer, no RPC. */
  usdcMonitor: UsdcMonitorConfig;
  /** EPIC-222-5: reconciliation config; enabled=false → no timer. */
  usdcReconciliation: UsdcReconciliationConfig;
}
