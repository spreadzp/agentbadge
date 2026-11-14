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
import { logger } from "@agentbadge/passport/logger";

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
  /**
   * Pre-flight guard (≈ paymentForPrice onBeforeChallenge): runs BEFORE
   * the 402 challenge AND before settle — don't charge for requests
   * that can't succeed. Returns a Response to short-circuit.
   */
  preCheck?: (c: Context) => Response | void | Promise<Response | void>;
  /** Post-settle hook — runs after UsageRecord write, before handler. */
  onSettled?: (
    c: Context,
    result: import("../x402-settle-seam.js").SettleSeamResult,
    resource: import("@agentbadge/payments").PaidResource,
  ) => void | Promise<void>;
}

export function x402GatewayMiddleware(
  config: X402GatewayMiddlewareConfig,
): MiddlewareHandler {
  const { service, registry } = config;

  return async (c: Context, next) => {
    // Hono serves HEAD via the GET handler — gate it under the GET
    // resource or a HEAD request would bypass payment entirely.
    const lookupMethod = c.req.method === "HEAD" ? "GET" : c.req.method;
    const resource = registry.findByRoute(lookupMethod, c.req.path);
    if (!resource) return next();

    const pre = await config.preCheck?.(c);
    if (pre) return pre;

    const resolved = await service.resolvePrice(resource);
    const amountAtomic = service.amountAtomicFor(
      resource,
      resolved.priceUsd,
    );
    // Misconfigured zero price → never silently "settle" $0; serve free
    // and surface the config error (M-1).
    if (amountAtomic === "0") {
      logger.warn("x402-gateway: zero-priced resource served free", {
        resource: resource.id,
      });
      return next();
    }

    if (!c.req.header("payment-signature")) {
      const accepts = (config.serviceAcceptsFor?.(amountAtomic) ?? []).filter(
        // Advertise only the resource's declared rail — a pilot must not
        // offer networks the UsageRecord/accounting can't attribute.
        (a) => a.network === resource.network,
      );
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

    const result = await service.verifyAndSettle(c, resource, amountAtomic);
    if (!result) {
      return errorResponse(
        c,
        402,
        "PAYMENT_REQUIRED",
        "Payment verification failed",
      );
    }

    // C-1: money already moved — post-settle accounting MUST NOT take the
    // resource down. On failure we still serve + emit PAYMENT-RESPONSE and
    // log a reconciliation record; the UsageRecord is the only lost data.
    try {
      const agentId = await service.resolveAgentId(result.payer);
      await service.recordUsage({
        settleResult: result,
        resource,
        requestId: service.requestIdFor(c, result),
        agentId,
        payload: {
          clientRequestId: c.req.header("x-request-id") ?? null,
        },
      });
      await config.onSettled?.(c, result, resource);
    } catch (err) {
      logger.error("x402-gateway: post-settle accounting failed — PAID request continues; reconcile manually", {
        tx: result.tx,
        payer: result.payer,
        resource: resource.id,
        requestId: c.req.header("x-request-id"),
        err: err instanceof Error ? err.message : String(err),
      });
    }

    c.set(X402_PAYMENT_KEY, result);
    c.header(
      "PAYMENT-RESPONSE",
      paymentResponseHeader(settleResponseFrom(result)),
    );
    await next();
  };
}
