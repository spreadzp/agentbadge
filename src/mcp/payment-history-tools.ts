/**
 * SLICE-129-20: MCP tool `payment_history` — OPS/INTERNAL tool.
 * Recent settled payments (gateway transfers) + failure ledger
 * entries, normalized and sorted desc. Read-only, flag-gated.
 */

import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";
import type { PaymentHistory } from "@agentbadge/circle-payments";

export interface PaymentHistoryToolConfig {
  paymentHistory: PaymentHistory;
}

let config: PaymentHistoryToolConfig | null = null;

export function setPaymentHistoryToolConfig(
  cfg: PaymentHistoryToolConfig | null,
): void {
  config = cfg;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

const STATUS_VALUES = new Set(["settled", "failed"]);

export async function paymentHistoryHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!config) {
    return {
      content: [
        {
          type: "text",
          text: "payment_history is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
        },
      ],
      isError: true,
    };
  }
  const status = args.status as string | undefined;
  if (status !== undefined && !STATUS_VALUES.has(status)) {
    return {
      content: [
        {
          type: "text",
          text: `Invalid status "${status}" — expected "settled" or "failed"`,
        },
      ],
      isError: true,
    };
  }
  const limit =
    typeof args.limit === "number" && args.limit > 0
      ? Math.floor(args.limit)
      : undefined;
  try {
    const entries = await config.paymentHistory({
      limit,
      status: status as "settled" | "failed" | undefined,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `History lookup failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

export function registerPaymentHistoryTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "payment_history",
    "[OPS/INTERNAL] Recent payment history for this server — settled gateway transfers merged with failure ledger entries (with reasons), sorted newest first. Optional status filter (settled|failed) and limit. Read-only ops tool.",
    {
      status: z
        .enum(["settled", "failed"])
        .optional()
        .describe("Filter by entry type; omit for all"),
      limit: z
        .number()
        .optional()
        .describe("Max entries to return (default 20)"),
    },
    paymentHistoryHandler,
  );
}
