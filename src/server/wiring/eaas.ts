// EPIC-154, SLICE-154-2: EaaS verdict API wiring.
// Mounted after wireCirclePayments — reuses its runtime for x402
// pricing (paymentForPrice on env-driven "$x.xx" prices).
// Gated on ARC_EAAS_ENABLED + circle payments being actually wired
// (POST needs an x402 rail; GETs mount only when eaas is enabled).

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import { arcChainFor } from "../lib/marketplace/chain";
import { createVerdictSigner } from "../lib/eaas/verdict";
import { getVerdictStore } from "../lib/eaas/store";
import { createEaasRoutes } from "../routes/eaas-api";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";

export function wireEaas(
  app: Hono,
  deps: { circleRuntime?: CirclePaymentsRuntime },
): void {
  const cfg = getConfig().eaas;
  if (!cfg?.enabled) return;

  // bstock section optional — verdict chainId follows ARC network, default testnet.
  const chainId = arcChainFor(
    getConfig().bstock?.arcNetwork ?? "eip155:5042002",
  ).id;
  const signer = createVerdictSigner(cfg.signerKey, chainId);
  const store = getVerdictStore();

  if (!deps.circleRuntime) {
    // No payment rail → the paid POST would silently bypass billing.
    // Fail closed: mount nothing rather than expose free verdicts.
    logger.warn("EaaS enabled but circle payments disabled — verdict API NOT mounted");
    return;
  }

  app.route(
    "/",
    createEaasRoutes({
      paymentForPrice: (price) => deps.circleRuntime!.paymentForPrice(price),
      verdictUsd: cfg.verdictUsd,
      scanUsd: cfg.scanUsd,
      maxBytes: cfg.maxBytes,
      rateRpm: cfg.rateRpm,
      signer,
      store,
    }),
  );
  logger.info("EaaS verdict API mounted", {
    verdictUsd: cfg.verdictUsd,
    scanUsd: cfg.scanUsd,
    store: store.name,
    chainId,
  });
}
