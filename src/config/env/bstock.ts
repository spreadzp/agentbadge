/**
 * bStock tracker config section (EPIC-141, SLICE-141-6).
 * Optional — only loaded when BSTOCK_ENABLED=true.
 *
 * MCP_AGENT_TOKENS=agent1:token1,agent2:token2 (Q4b) — bearer tokens
 * for /mcp/bstock namespace auth.
 */

import type { BstockEnvConfig } from "./types";
import { booleanFlag } from "./validators";

const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const DEFAULT_MAX_SSE = 20;

export function loadBstock(errors: string[]): BstockEnvConfig | undefined {
  if (!booleanFlag("BSTOCK_ENABLED")) return undefined;

  const agentTokens = new Map<string, string>();
  const raw = process.env.MCP_AGENT_TOKENS;
  if (!raw || !raw.trim()) {
    errors.push("MCP_AGENT_TOKENS required when BSTOCK_ENABLED=true");
  } else {
    for (const pair of raw.split(",")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx <= 0 || idx === trimmed.length - 1) {
        errors.push(
          `Invalid MCP_AGENT_TOKENS entry "${trimmed}": expected agent:token`,
        );
        continue;
      }
      const agent = trimmed.slice(0, idx).trim();
      const token = trimmed.slice(idx + 1).trim();
      agentTokens.set(token, agent);
    }
    if (agentTokens.size === 0) {
      errors.push("MCP_AGENT_TOKENS parsed to zero valid agent:token pairs");
    }
  }

  const rateLimitPerMin = Number(
    process.env.BSTOCK_RATE_LIMIT_PER_MIN ?? DEFAULT_RATE_LIMIT_PER_MIN,
  );
  if (!Number.isFinite(rateLimitPerMin) || rateLimitPerMin <= 0) {
    errors.push("BSTOCK_RATE_LIMIT_PER_MIN must be a positive number");
  }

  const maxSseConnections = Number(
    process.env.BSTOCK_MAX_SSE_CONNECTIONS ?? DEFAULT_MAX_SSE,
  );
  if (!Number.isFinite(maxSseConnections) || maxSseConnections <= 0) {
    errors.push("BSTOCK_MAX_SSE_CONNECTIONS must be a positive number");
  }

  return {
    enabled: true,
    agentTokens,
    rateLimitPerMin,
    maxSseConnections,
  };
}
