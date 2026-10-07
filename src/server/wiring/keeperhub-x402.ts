// EPIC-140 (SLICE-140-3): KeeperHub x402 premium gate extracted from index.ts.
// MUST be called before app.route("/api", keeperhubApiRoutes) — Hono composes
// handlers in registration order, so middleware added after the route never runs.
//
// SLICE-157-3 (D1): legacy x402.org stack removed — the premium gate exists
// only on the circle-payments runtime (multi-chain accepts[]: Gateway + exact
// + Arc self-settle). No runtime → route unprotected (warn).

import type { Hono, MiddlewareHandler } from "hono";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import { bazaarExtensionFor } from "../lib/service-catalog/bazaar";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";

export function wireKeeperhubX402(
  app: Hono,
  deps: { runtime?: CirclePaymentsRuntime } = {},
): void {
  const khCfg = getConfig().keeperhub;
  if (!(khCfg?.enabled && khCfg.x402?.enabled)) return;
  const x402Cfg = khCfg.x402;

  if (!deps.runtime) {
    logger.warn(
      "x402 keeperhub: circle-payments runtime unavailable — POST /api/keeperhub/scan/premium unprotected",
    );
    return;
  }

  app.use(
    "/api/keeperhub/scan/premium",
    deps.runtime.paymentForPrice(x402Cfg.price, {
      payTo: x402Cfg.payTo,
      methods: ["POST"],
      description:
        "AgentBadge onchain scan recording — executed through KeeperHub, recorded on TrustRegistry (Base Sepolia)",
      mimeType: "application/json",
      // 179-3: bazaar declaration from the SKU registry (keeperhub:scan-premium).
      extensions: bazaarExtensionFor("keeperhub:scan-premium"),
      // 157-1: legacy accepts advertised extra.paymentFlow=upfront.
      extraRequirements: { paymentFlow: "upfront" },
    }) as MiddlewareHandler,
  );
  logger.info(
    "x402 premium middleware wired for POST /api/keeperhub/scan/premium via circle-payments runtime",
  );
}
