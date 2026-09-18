/**
 * SLICE-129-23: Demo endpoints pair — killer demo (D23).
 *
 * GET /api/demo/verified-data — paid resource served by a verified seller:
 *   402 carries the passport identity extension.
 * GET /api/demo/raw-data — identical payload + price, NO identity extension.
 *
 * Buyer demo script fetches both 402s, compares extensions, pays the
 * verified one — the trust signal is visible in the wire format.
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { PaymentMiddleware } from "./identity";

export interface DemoRoutesDeps {
  /** paymentFor("demo.data") WITH identity extension */
  verifiedPayment: PaymentMiddleware;
  /** paymentFor("demo.data", {identity:false}) — no extension */
  rawPayment: PaymentMiddleware;
}

const demoDataSchema = z.object({
  data: z.string(),
  source: z.string(),
  servedAt: z.string(),
});

const PAYLOAD = {
  data: "agent-readiness: score=87 tier=gold checks=14/17",
  source: "agentbadge-demo",
};

export function createDemoRoutes(deps: DemoRoutesDeps): Hono {
  const routes = new Hono();

  const response = () => ({
    ...PAYLOAD,
    servedAt: new Date().toISOString(),
  });

  routes.get(
    "/api/demo/verified-data",
    describeRoute({
      description:
        "Paid demo resource from verified seller (402 carries passport identity extension)",
      responses: {
        200: {
          description: "Demo payload",
          content: { "application/json": { schema: resolver(demoDataSchema) } },
        },
        402: { description: "Payment required (x402, identity extension)" },
      },
    }),
    deps.verifiedPayment,
    (c) => c.json(response()),
  );

  routes.get(
    "/api/demo/raw-data",
    describeRoute({
      description:
        "Paid demo resource, identical payload — no identity extension (unverified seller)",
      responses: {
        200: {
          description: "Demo payload",
          content: { "application/json": { schema: resolver(demoDataSchema) } },
        },
        402: { description: "Payment required (x402, no extension)" },
      },
    }),
    deps.rawPayment,
    (c) => c.json(response()),
  );

  return routes;
}
