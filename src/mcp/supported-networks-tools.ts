/**
 * SLICE-129-19: MCP tool `supported_networks` — capability matrix.
 * Returns the router's accepts[] for a reference price plus per-flag
 * capability state. Flags are read per call (getFlags) so flag
 * changes are reflected without restart. Flag-gated.
 */

import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";
import type { PaymentRouter } from "@agentbadge/circle-payments";

/** Reference price for the accepts matrix — $0.001 in 6-dec base units. */
const REFERENCE_AMOUNT = "1000";

export interface CircleCapabilityFlags {
  gateway: boolean;
  arc: boolean;
  identity: boolean;
  escrow: boolean;
}

export interface SupportedNetworksToolConfig {
  router: PaymentRouter;
  /** Live flag reader — called per invocation (no restart needed) */
  getFlags: () => CircleCapabilityFlags;
}

let config: SupportedNetworksToolConfig | null = null;

export function setSupportedNetworksToolConfig(
  cfg: SupportedNetworksToolConfig | null,
): void {
  config = cfg;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

export async function supportedNetworksHandler(
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!config) {
    return {
      content: [
        {
          type: "text",
          text: "supported_networks is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
        },
      ],
      isError: true,
    };
  }
  try {
    const accepts = config.router.acceptsFor(REFERENCE_AMOUNT);
    const capabilities = config.getFlags();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { referenceAmount: REFERENCE_AMOUNT, accepts, capabilities },
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
          text: `Capability lookup failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

export function registerSupportedNetworksTools(
  ns?: NamespaceRegistry,
): void {
  const r = getRegistry(ns);
  r.registerTool(
    "supported_networks",
    "Get the Circle nanopayments capability matrix: accepts[] payment requirements (schemes, networks, assets, payTo) for a $0.001 reference price, plus per-flag capability state (gateway, arc, identity, escrow). Reflects live flag state. Read-only.",
    {},
    supportedNetworksHandler,
  );
}
