// SLICE-176-5: agent wallet kill-switch API (extracted for max-lines).
//  POST /api/wallets/:addr/suspend + /resume — owner wallet-sig auth
//  (same as DELETE: registrant or venue admin), idempotent, releases
//  active reserves on suspend via lifecycle.suspendWallet (176-4),
//  emits wallet.suspended / wallet.resumed alerts (audit feed).

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { logger } from "@agentbadge/passport";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import type { SpendLedger } from "../lib/agent-wallet/ledger";
import { suspendWallet } from "../lib/agent-wallet/lifecycle";
import { emitSpendAlert } from "../lib/agent-wallet/audit";
import {
  ADDRESS_RE,
  sigWallet,
  ownerGate,
} from "./agent-wallet-api";

export interface AgentWalletKillswitchRoutesDeps {
  store: AgentWalletStore;
  /** Needed by suspend — releases active reserves. */
  ledger: SpendLedger;
}

export function createAgentWalletKillswitchRoutes(
  deps: AgentWalletKillswitchRoutesDeps,
): Hono {
  const routes = new Hono();

  for (const flag of [true, false] as const) {
    const action = flag ? "suspend" : "resume";
    routes.post(
      `/api/wallets/:address/${action}`,
      describeRoute({
        description: flag
          ? "Suspend wallet — instant deny for new spend intents (owner kill-switch)"
          : "Resume a suspended wallet",
        responses: {
          200: { description: "{suspended, suspendedAt?, suspendedBy?, envelope}" },
          400: { description: "Invalid address" },
          401: { description: "Signature required" },
          403: { description: "Not registrant / venue admin" },
          404: { description: "Not found" },
        },
      }),
      async (c) => {
        const addr = c.req.param("address");
        if (!ADDRESS_RE.test(addr)) {
          return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
            "invalid address");
        }
        const rec = await deps.store.get(addr);
        if (!rec || !rec.active) {
          return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
            "wallet not registered");
        }
        const caller = await sigWallet(c);
        if (!caller) {
          return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
            "valid X-Wallet/X-Sig/X-Timestamp required");
        }
        const authErr = await ownerGate(c, rec, caller);
        if (authErr) return authErr;

        const r = await suspendWallet(
          { store: deps.store, ledger: deps.ledger },
          rec.address,
          flag,
          caller,
        );
        if (!r.ok) {
          return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
            "wallet not registered");
        }
        emitSpendAlert(
          flag ? "wallet.suspended" : "wallet.resumed",
          rec.address,
          { actor: caller, released: r.released },
          rec.venueId,
        );
        logger.info(`agent-wallet: ${action}ed`, {
          address: rec.address,
          by: caller,
          released: r.released,
        });
        const fresh = await deps.store.get(rec.address);
        return c.json({
          address: rec.address,
          suspended: r.suspended,
          ...(fresh?.suspendedAt ? { suspendedAt: fresh.suspendedAt } : {}),
          ...(fresh?.suspendedBy ? { suspendedBy: fresh.suspendedBy } : {}),
          envelope: fresh?.envelope ?? rec.envelope,
        });
      },
    );
  }

  return routes;
}
