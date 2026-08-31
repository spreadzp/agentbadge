/**
 * AgentCard builder + minimal HTTP server.
 *
 * Reference: hackathon-flow.md:205-220 (AgentCard shape),
 *            SLICE-4-4 (Hermes Demo Agent)
 */

import { Hono } from "hono";
import type { Tier, Capability } from "@agentbadge/hedera-core";
import { ErrorCodes } from "../server/lib/error-codes";
import { errorResponse } from "../server/lib/error-response";

/** AgentCard manifest served at /.well-known/agent-card.json */
export interface AgentCard {
  name: string;
  did: string;
  passportTokenId: string;
  passportSerial: number;
  capabilities: Capability[];
  tier: string;
  endpoints: {
    process: { url: string; payment: string; price: string };
    status: { url: string; payment: string };
  };
}

/** Build an AgentCard from passport issuance result. */
export function buildAgentCard(params: {
  name: string;
  did: string;
  passportTokenId: string;
  passportSerial: number;
  capabilities: Capability[];
  tier: Tier;
  endpoint: string;
}): AgentCard {
  const tierCapitalized = params.tier.charAt(0).toUpperCase() + params.tier.slice(1);

  return {
    name: params.name,
    did: params.did,
    passportTokenId: params.passportTokenId,
    passportSerial: params.passportSerial,
    capabilities: params.capabilities,
    tier: tierCapitalized,
    endpoints: {
      process: {
        url: "/api/process",
        payment: "x402",
        price: "5 HBAR",
      },
      status: {
        url: "/api/status",
        payment: "free",
      },
    },
  };
}

/**
 * Start a minimal Hono server serving the AgentCard at
 * /.well-known/agent-card.json.
 *
 * Returns the server instance so the caller can stop it.
 */
export function serveAgentCard(card: AgentCard, port = 4030) {
  const app = new Hono();

  app.get("/.well-known/agent-card.json", (c) => c.json(card));

  app.get("/api/status", (c) => c.json({ status: "online", name: card.name, did: card.did }));

  app.get("/api/process", (c) =>
    errorResponse(c, 402, ErrorCodes.PAYMENT_REQUIRED, "Payment required", { hint: "Send 5 HBAR via x402 protocol" }),
  );

  return Bun.serve({ port, fetch: app.fetch });
}
