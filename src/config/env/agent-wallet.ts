/**
 * Agent Wallet env section — EPIC-155, SLICE-155-1.
 *
 * Whole feature gated behind AGENT_WALLET_ENABLED (codebase boolean
 * convention: "true"/"1" enables). When enabled, routes mount and the
 * Circle CLI read-paths activate; CLI missing → graceful "unavailable"
 * (registry still works — balance mirrors degrade, never crash).
 *
 *   AGENT_WALLET_ENABLED          — 0/1 (default off)
 *   CIRCLE_CLI_PATH               — binary name/path (default "circle")
 *   AGENT_WALLET_CLI_TIMEOUT_MS   — spawn timeout (default 15000)
 *   AGENT_WALLET_CHAIN            — default chain for mirror calls (ARC)
 *   AGENT_WALLET_STORE            — json (default) | memory
 *   AGENT_WALLET_LEDGER_STORE     — sqlite (default) | json | memory
 *   AGENT_WALLET_REQUIRE_REGISTERED — 0/1 deny unregistered wallets (155-2)
 *   AGENT_WALLET_DEFAULT_CAPS     — JSON SpendCaps fallback envelope (155-2)
 *   AGENT_WALLET_LOW_USD          — low-balance alert threshold (155-5, 1.0)
 *   AGENT_WALLET_LOW_WEBHOOK_URL  — optional webhook on low-balance (155-5)
 */

import type { AgentWalletEnvConfig } from "./types";
import { booleanFlag } from "./validators";

function intVar(
  name: string,
  fallback: number,
  min: number,
  errors: string[],
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    errors.push(`Invalid ${name}: expected integer >= ${min}, got "${raw}"`);
    return fallback;
  }
  return n;
}

export function loadAgentWallet(
  errors: string[],
): AgentWalletEnvConfig | undefined {
  if (!booleanFlag("AGENT_WALLET_ENABLED")) return undefined;

  const cliPath = (process.env.CIRCLE_CLI_PATH ?? "circle").trim() || "circle";
  const cliTimeoutMs = intVar("AGENT_WALLET_CLI_TIMEOUT_MS", 15_000, 100, errors);
  const chain = (process.env.AGENT_WALLET_CHAIN ?? "ARC").trim() || "ARC";

  const rawStore = (process.env.AGENT_WALLET_STORE ?? "json").toLowerCase();
  const store = rawStore === "memory" ? "memory" : "json";

  // SLICE-155-2: spend envelope config.
  const rawLedger = (
    process.env.AGENT_WALLET_LEDGER_STORE ?? "sqlite"
  ).toLowerCase();
  const ledgerStore =
    rawLedger === "memory" || rawLedger === "json" ? rawLedger : "sqlite";

  const requireRegistered = booleanFlag("AGENT_WALLET_REQUIRE_REGISTERED");

  // SLICE-155-5: low-balance signal.
  const lowUsd = intVar("AGENT_WALLET_LOW_USD", 1, 0, errors);
  const lowWebhookUrl =
    (process.env.AGENT_WALLET_LOW_WEBHOOK_URL ?? "").trim() || undefined;

  // SLICE-155-6: spend audit alerts.
  const staleReserveMin = intVar("AGENT_WALLET_STALE_RESERVE_MIN", 10, 1, errors);
  const alertWebhookUrl =
    (process.env.AGENT_WALLET_ALERT_WEBHOOK_URL ?? "").trim() || undefined;

  let defaultCaps: AgentWalletEnvConfig["defaultCaps"];
  const rawCaps = process.env.AGENT_WALLET_DEFAULT_CAPS;
  if (rawCaps) {
    try {
      const parsed = JSON.parse(rawCaps) as Record<string, unknown>;
      const caps: NonNullable<AgentWalletEnvConfig["defaultCaps"]> = {};
      for (const k of [
        "perTxUsd",
        "dailyUsd",
        "weeklyUsd",
        "monthlyUsd",
      ] as const) {
        const v = parsed[k];
        if (v === undefined || v === null) continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`${k} must be a non-negative number`);
        }
        caps[k] = n;
      }
      const seq = (["perTxUsd", "dailyUsd", "weeklyUsd", "monthlyUsd"] as const)
        .map((k) => caps[k])
        .filter((v): v is number => v !== undefined);
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] < seq[i - 1]) {
          throw new Error("caps must be monotonic perTx≤daily≤weekly≤monthly");
        }
      }
      if (Object.keys(caps).length > 0) defaultCaps = caps;
    } catch (err) {
      errors.push(
        `Invalid AGENT_WALLET_DEFAULT_CAPS: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    enabled: true,
    cliPath,
    cliTimeoutMs,
    chain,
    store,
    ledgerStore,
    requireRegistered,
    lowUsd,
    staleReserveMin,
    ...(lowWebhookUrl ? { lowWebhookUrl } : {}),
    ...(alertWebhookUrl ? { alertWebhookUrl } : {}),
    ...(defaultCaps ? { defaultCaps } : {}),
  };
}
