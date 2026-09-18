/**
 * SLICE-129-17: MCP tool `agent_identity` — passport data by EVM
 * address. Shares the same `lookup` as GET /api/identity/:address
 * (129-11) — identical payload shape, no duplication. Flag-gated.
 */

import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";
import type { IdentityLookupResult } from "../server/routes/identity";

export interface AgentIdentityToolConfig {
  lookup: (address: string) => Promise<IdentityLookupResult | undefined>;
}

let config: AgentIdentityToolConfig | null = null;

export function setAgentIdentityToolConfig(
  cfg: AgentIdentityToolConfig | null,
): void {
  config = cfg;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function agentIdentityHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!config) {
    return {
      content: [
        {
          type: "text",
          text: "agent_identity is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
        },
      ],
      isError: true,
    };
  }
  const address = args.address as string | undefined;
  if (!address || !EVM_ADDRESS.test(address)) {
    return {
      content: [
        {
          type: "text",
          text: "Invalid or missing address — expected 0x + 40 hex chars",
        },
      ],
      isError: true,
    };
  }
  try {
    const passport = await config.lookup(address);
    if (!passport) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ found: false, address }, null, 2),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { address, ...passport, verifiedAt: new Date().toISOString() },
            null,
            2,
          ),
        },
      ],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Identity lookup failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

export function registerAgentIdentityTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "agent_identity",
    "Get AgentBadge passport identity for an EVM address — passportTokenId, readinessScore, mintTx, issuedAt, chain. Same payload as GET /api/identity/:address. Returns {found:false} when no passport exists.",
    {
      address: z
        .string()
        .describe("EVM address to look up (0x + 40 hex chars)"),
    },
    agentIdentityHandler,
  );
}
