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
  /** "auto" (default) → db when DATABASE_ENABLED, else sqlite→json.
   *  "db" → Postgres required (fails fast when disabled). */
  ledgerStore: "auto" | "db" | "json" | "sqlite" | "memory";
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
  /** SLICE-156-6: AGENT_WALLET_DELEGATE_ENABLED (0/1) — mounts the
   *  delegate register/revoke surface; requires ARC_DELEGATE_KEY. */
  delegateEnabled: boolean;
  /** SLICE-156-6: ARC_DELEGATE_KEY — server delegate EOA private key
   *  (0x-prefixed). Scope: unified-balance SPEND ONLY — never used for
   *  withdraw/removeFund. Absent ⇒ delegate feature off. */
  delegateKey?: string;
  /** SLICE-176-6: AGENT_WALLET_APPROVAL_STORE — parked-intent backend
   *  ("auto" → sqlite→json; db lands with the 176-11 repo). */
  approvalStore: "auto" | "sqlite" | "json" | "memory";
  /** SLICE-176-6: AGENT_WALLET_MAX_PENDING_APPROVALS — per-wallet
   *  pending cap; park() above → approval_queue_full (default 20). */
  maxPendingApprovals: number;
}
