/**
 * SLICE-206-15 (EPIC-206): demo micro-paywall wiring.
 *
 * GET /api/v1/demo/scan-lite — x402-gated at demoScanPriceTag()
 * (env DEMO_SCAN_USDC, atomic; default 1000 = $0.001).
 *
 * Fail closed like wireEaas: no circle-payments runtime → the route
 * mounts NOTHING rather than serving free paid-tier results.
 * Gate BEFORE the route mount — Hono composes in registration order.
 */
import type { Hono, MiddlewareHandler } from "hono";
import { logger } from "@agentbadge/passport/logger";
import { demoScanPriceTag } from "../lib/demo-scan";
import { demoApiRoutes } from "../routes/demo-api";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";

export function wireDemoX402(
  app: Hono,
  deps: { runtime?: CirclePaymentsRuntime },
): void {
  if (!deps.runtime) {
    logger.warn(
      "demo scan-lite: no circle-payments runtime — paid route NOT mounted (fail closed)",
    );
    return;
  }

  app.use(
    "/api/v1/demo/scan-lite",
    deps.runtime.paymentForPrice(demoScanPriceTag(), {
      methods: ["GET"],
      description:
        "Demo scan-lite — one-page agent-readiness probe " +
        "(og/meta + llms.txt/JSON-LD/agents.txt signals)",
      mimeType: "application/json",
    }) as MiddlewareHandler,
  );

  app.route("/", demoApiRoutes);
  logger.info(
    `x402 demo gate wired — GET /api/v1/demo/scan-lite at ${demoScanPriceTag()}`,
  );
}
