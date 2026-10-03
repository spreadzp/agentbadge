// EPIC-140 (SLICE-140-3): KeeperHub x402 premium gate extracted from index.ts.
// MUST be called before app.route("/api", keeperhubApiRoutes) — Hono composes
// handlers in registration order, so middleware added after the route never runs.
//
// SLICE-156-1: when the Circle payments runtime is available the premium gate
// runs on it — multi-chain accepts[] (Gateway + exact + Arc self-settle) with
// the keeperhub treasury kept via per-payTo router. Without the runtime the
// legacy x402 stack stays in place (zero behavior change).

import type { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer, type SchemeNetworkServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";

export function wireKeeperhubX402(
  app: Hono,
  deps: { runtime?: CirclePaymentsRuntime } = {},
): void {
  const khCfg = getConfig().keeperhub;
  if (!(khCfg?.enabled && khCfg.x402?.enabled)) return;
  const x402Cfg = khCfg.x402;

  if (deps.runtime) {
    try {
      app.use(
        "/api/keeperhub/scan/premium",
        deps.runtime.paymentForPrice(x402Cfg.price, {
          payTo: x402Cfg.payTo,
          methods: ["POST"],
          description:
            "AgentBadge onchain scan recording — executed through KeeperHub, recorded on TrustRegistry (Base Sepolia)",
          mimeType: "application/json",
        }) as never,
      );
      logger.info(
        "x402 premium middleware wired for POST /api/keeperhub/scan/premium via circle-payments runtime",
      );
      return;
    } catch (e) {
      logger.error("x402 runtime wiring failed — falling back to legacy stack", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    // Legacy path (pre-156): single-chain exact on Base Sepolia via the
    // keeperhub-configured facilitator.
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
    logger.info("x402 premium middleware wired for POST /api/keeperhub/scan/premium (legacy stack)");
  } catch (e) {
    logger.error("Failed to wire x402 middleware — premium route unprotected", { error: e instanceof Error ? e.message : String(e) });
  }
}
