/**
 * SLICE-129-18: MCP tool `circle_wallet_balance` — OPS/INTERNAL tool.
 * Seller wallet USDC + Gateway balances per chain. Read-only,
 * flag-gated. Not for buyer agents — exposes server wallet state.
 */

import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";
import type { BalanceLookup } from "@agentbadge/circle-payments";

export interface CircleWalletBalanceToolConfig {
  balanceLookup: BalanceLookup;
}

let config: CircleWalletBalanceToolConfig | null = null;

export function setCircleWalletBalanceToolConfig(
  cfg: CircleWalletBalanceToolConfig | null,
): void {
  config = cfg;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

export async function circleWalletBalanceHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!config) {
    return {
      content: [
        {
          type: "text",
          text: "circle_wallet_balance is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
        },
      ],
      isError: true,
    };
  }
  const chain = args.chain as string | undefined;
  try {
    const balances = await config.balanceLookup(chain);
    return {
      content: [{ type: "text", text: JSON.stringify(balances, null, 2) }],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Balance lookup failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

export function registerCircleWalletBalanceTools(
  ns?: NamespaceRegistry,
): void {
  const r = getRegistry(ns);
  r.registerTool(
    "circle_wallet_balance",
    "[OPS/INTERNAL] Get this server's seller wallet balances — on-chain USDC (balanceOf) plus Circle Gateway balance per enabled chain. Optional chain filter (CAIP-2 like eip155:84532 or name like 'Arc Testnet'). Returns [{network, chain, wallet:{balance,formatted}, gateway?}]. Read-only ops tool — not for buyer agents.",
    {
      chain: z
        .string()
        .optional()
        .describe(
          "Filter to one chain: CAIP-2 id (eip155:84532) or name (Base Sepolia, Arc Testnet). Omit for all enabled chains.",
        ),
    },
    circleWalletBalanceHandler,
  );
}
