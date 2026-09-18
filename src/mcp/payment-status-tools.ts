/**
 * SLICE-129-16: MCP tool `payment_status` — normalized payment status
 * by any ref: gateway transfer UUID, on-chain tx hash, or internal
 * ledger id (paymentId / txRef). Read-only, flag-gated.
 */

import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";
import type { PaymentStatusLookup } from "@agentbadge/circle-payments";

export interface PaymentStatusToolConfig {
  statusLookup: PaymentStatusLookup;
}

let config: PaymentStatusToolConfig | null = null;

export function setPaymentStatusToolConfig(
  cfg: PaymentStatusToolConfig | null,
): void {
  config = cfg;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

export async function paymentStatusHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!config) {
    return {
      content: [
        {
          type: "text",
          text: "payment_status is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
        },
      ],
      isError: true,
    };
  }
  const ref = args.ref as string | undefined;
  if (!ref) {
    return {
      content: [
        {
          type: "text",
          text: "Missing required argument: ref (gateway transfer UUID, tx hash, or internal payment id)",
        },
      ],
      isError: true,
    };
  }
  try {
    const status = await config.statusLookup(ref);
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Status lookup failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

export function registerPaymentStatusTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "payment_status",
    "Get normalized payment status for any Circle nanopayments rail. Pass a ref: gateway transfer UUID (Gateway rail), 0x tx hash (Arc self-settle / on-chain), or internal payment id (ledger). Returns {status: pending|confirmed|completed|failed|not_found, scheme, network, amount, confirmedAt}. Read-only.",
    {
      ref: z
        .string()
        .describe(
          "Payment reference: gateway transfer UUID, 0x transaction hash, or internal payment id",
        ),
    },
    paymentStatusHandler,
  );
}
