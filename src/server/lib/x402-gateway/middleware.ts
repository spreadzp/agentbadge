/**
 * SLICE-223-4: x402GatewayMiddleware — paid-route gate.
 *
 * Route hit → registry lookup; unregistered path passes through.
 * No payment header → spec 402 via the official adapter.
 * Header present → seam verifies+settles; on success a UsageRecord is
 * appended and the response carries PAYMENT-RESPONSE.
 */

import type { Context, MiddlewareHandler } from "hono";

import type { ResourceRegistry } from "@agentbadge/payments";

import { errorResponse } from "../error-response.js";
import {
  X402_PAYMENT_KEY,
  paymentRequiredHeader,
  paymentResponseHeader,
  settleResponseFrom,
} from "./protocol.js";
import type { X402PaymentService } from "./service.js";

export interface X402GatewayMiddlewareConfig {
  service: X402PaymentService;
  registry: ResourceRegistry;
  /** Router bridge: amount → protocol accepts. */
  serviceAcceptsFor?: (amountAtomic: string) => import("./types.js").X402PaymentRequirements[];
  /** Bazaar extension for bazaar-enabled resources (D-223-8). */
  bazaarExtensionFor?: (
    resourceId: string,
  ) => Record<string, unknown> | undefined;
}

export function x402GatewayMiddleware(
  config: X402GatewayMiddlewareConfig,
): MiddlewareHandler {
  const { service, registry } = config;

  return async (c: Context, next) => {
    const resource = registry.findByRoute(c.req.method, c.req.path);
    if (!resource) return next();

    if (!c.req.header("payment-signature")) {
      const resolved = await service.resolvePrice(resource);
      const accepts = config.serviceAcceptsFor
        ? config.serviceAcceptsFor(
            service.amountAtomicFor(resource, resolved.priceUsd),
          )
        : [];
      c.header(
        "PAYMENT-REQUIRED",
        paymentRequiredHeader({
          accepts,
          resource: {
            url: c.req.url,
            description: resource.description,
            mimeType: "application/json",
          },
          ...(resource.bazaar && config.bazaarExtensionFor
            ? { extensions: config.bazaarExtensionFor(resource.id) }
            : {}),
        }),
      );
      return errorResponse(
        c,
        402,
        "PAYMENT_REQUIRED",
        "Payment required for this resource",
      );
    }

    const resolved = await service.resolvePrice(resource);
    const amountAtomic = service.amountAtomicFor(
      resource,
      resolved.priceUsd,
    );
    const result = await service.verifyAndSettle(c, resource, amountAtomic);
    if (!result) {
      return errorResponse(
        c,
        402,
        "PAYMENT_REQUIRED",
        "Payment verification failed",
      );
    }

    const agentId = await service.resolveAgentId(result.payer);
    await service.recordUsage({
      settleResult: result,
      resource,
      requestId: service.requestIdFor(c),
      agentId,
    });

    c.set(X402_PAYMENT_KEY, result);
    c.header(
      "PAYMENT-RESPONSE",
      paymentResponseHeader(settleResponseFrom(result)),
    );
    await next();
  };
}
