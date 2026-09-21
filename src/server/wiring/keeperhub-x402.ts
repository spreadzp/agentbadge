// EPIC-140 (SLICE-140-3): KeeperHub x402 premium gate extracted from index.ts.
// MUST be called before app.route("/api", keeperhubApiRoutes) — Hono composes
// handlers in registration order, so middleware added after the route never runs.

import type { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer, type SchemeNetworkServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";

export function wireKeeperhubX402(app: Hono): void {
  const khCfg = getConfig().keeperhub;
  if (khCfg?.enabled && khCfg.x402?.enabled) {
    const x402Cfg = khCfg.x402;
    try {
      const facilitatorClient = new HTTPFacilitatorClient({ url: x402Cfg.facilitatorUrl });
      // Cast: @x402/evm bundles its own @x402/core — getAssetDecimals return type differs structurally
      const resourceServer = new x402ResourceServer(facilitatorClient).register("eip155:84532", new ExactEvmScheme() as unknown as SchemeNetworkServer);
      app.use(paymentMiddleware({
        "POST /api/keeperhub/scan/premium": {
          accepts: [{ scheme: "exact", price: x402Cfg.price, network: "eip155:84532", payTo: x402Cfg.payTo, extra: { paymentFlow: "upfront" } }],
          description: "AgentBadge onchain scan recording — executed through KeeperHub, recorded on TrustRegistry (Base Sepolia)",
          mimeType: "application/json",
        },
      }, resourceServer));
      logger.info("x402 premium middleware wired for POST /api/keeperhub/scan/premium");
    } catch (e) {
      logger.error("Failed to wire x402 middleware — premium route unprotected", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}
