/** Agent Wallet env config type (EPIC-155); absent = feature off.
 *  Split from types.ts — file is at the 300-line limit. */

export interface AgentWalletEnvConfig {
  enabled: boolean;
  /** CIRCLE_CLI_PATH, AGENT_WALLET_CLI_TIMEOUT_MS, AGENT_WALLET_CHAIN. */
  cliPath: string;
  cliTimeoutMs: number;
  chain: string;
  /** AGENT_WALLET_STORE | AGENT_WALLET_LEDGER_STORE. */
  store: "json" | "memory";
  ledgerStore: "json" | "sqlite" | "memory";
  /** AGENT_WALLET_REQUIRE_REGISTERED | AGENT_WALLET_DEFAULT_CAPS. */
  requireRegistered: boolean;
  defaultCaps?: Partial<
    Record<"perTxUsd" | "dailyUsd" | "weeklyUsd" | "monthlyUsd", number>
  >;
  /** SLICE-155-5: AGENT_WALLET_LOW_USD — low-balance alert threshold
   *  (default 1.0). */
  lowUsd: number;
  /** SLICE-155-5: AGENT_WALLET_LOW_WEBHOOK_URL — optional webhook
   *  fired on low-balance events (ARC_BV_WEBHOOK_URL pattern). */
  lowWebhookUrl?: string;
  /** SLICE-155-6: AGENT_WALLET_STALE_RESERVE_MIN — reserved-without-
   *  settle alert threshold minutes (default 10). */
  staleReserveMin: number;
  /** SLICE-155-6: AGENT_WALLET_ALERT_WEBHOOK_URL — optional webhook
   *  for spend alert events (cap_denied/failed/release_late/
   *  low_balance), 154-6 retry backoff. */
  alertWebhookUrl?: string;
}
