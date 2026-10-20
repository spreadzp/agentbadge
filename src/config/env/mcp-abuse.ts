/**
 * MCP abuse-guard config section (EPIC-200, SLICE-200-08, D-200-2).
 *
 * Default ON — protective infrastructure like the global rate limiter,
 * not a feature flag. MCP_ABUSE_ENABLED=false disables entirely.
 * No error accumulation: every value has a safe default.
 */

import type { McpAbuseEnvConfig } from "./mcp-abuse-types";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  console.warn(
    `[mcp-abuse] invalid ${name}="${raw}" — falling back to ${fallback}`,
  );
  return fallback;
}

// USDC-style amount: optional $ prefix, >0, ≤6 decimals (arc-audit M-5).
const PRICE_RE = /^\$?\d+(\.\d{1,6})?$/;

function validPrice(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!PRICE_RE.test(raw) || Number.parseFloat(raw.replace("$", "")) <= 0) {
    console.warn(
      `[mcp-abuse] invalid MCP_HEAVY_X402_PRICE="${raw}" — x402 gate disarmed`,
    );
    return undefined;
  }
  return raw;
}

export function loadMcpAbuse(): McpAbuseEnvConfig | undefined {
  if (process.env.MCP_ABUSE_ENABLED === "false") return undefined;

  const heavyOpsRaw = process.env.MCP_ABUSE_HEAVY_OPS;
  const heavyOps = heavyOpsRaw
    ? heavyOpsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    : undefined;

  const heavyX402Price = validPrice(process.env.MCP_HEAVY_X402_PRICE);
  const heavyX402PayTo = process.env.MCP_HEAVY_X402_PAYTO;
  // Arm the x402 seam only when BOTH are set — a price without a payee
  // (or vice versa) is a misconfig, not a partial gate.
  const x402 =
    heavyX402Price && heavyX402PayTo
      ? { heavyX402Price, heavyX402PayTo }
      : {};

  return {
    enabled: true,
    anonRpm: intEnv("MCP_ABUSE_ANON_RPM", 60),
    keyedRpm: intEnv("MCP_ABUSE_KEYED_RPM", 120),
    heavyRpm: intEnv("MCP_ABUSE_HEAVY_RPM", 10),
    heavyOps,
    ...x402,
  };
}
