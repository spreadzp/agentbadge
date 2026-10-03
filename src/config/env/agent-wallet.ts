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

  return { enabled: true, cliPath, cliTimeoutMs, chain, store };
}
