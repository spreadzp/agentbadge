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

import type { X402FulfillmentOutcome } from "@agentbadge/econ-events";

import { errorResponse } from "../error-response.js";
import {
  emitX402Fulfillment,
  type FulfillmentLeg,
} from "../econ-ledger/x402-fulfillment.js";
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
  /**
   * SLICE-257-6: post-handler evidence emitter. Runs after the paid
   * handler settles its outcome; fire-and-forget — must never change
   * the response. Injectable for tests; defaults to the econ-ledger
   * `x402_fulfillment` emitter.
   */
  emitFulfillment?: (leg: FulfillmentLeg) => void;
}

/** Response is a live stream whose delivery we can't verify post-next(). */
function isStreamingResponse(c: Context): boolean {
  const res = c.res;
  const type = res.headers.get("content-type") ?? "";
  return (
    type.startsWith("text/event-stream") ||
    res.headers.get("transfer-encoding") === "chunked"
  );
}

/**
 * Post-handler outcome → honest outcome term. A thrown handler is
 * direct evidence of server-side failure; a real abort signal means
 * the stream broke; 2xx is the only status that proves completion —
 * anything else without a reliable signal is `unknown`, never guessed.
 */
export function classifyFulfillmentOutcome(
  c: Context,
  handlerThrew: boolean,
): { outcome: X402FulfillmentOutcome; httpStatus?: number } {
  if (handlerThrew) return { outcome: "upstream_error" };
  if (c.req.raw.signal.aborted) return { outcome: "stream_aborted" };
  const httpStatus = c.res.status;
  if (httpStatus >= 200 && httpStatus < 300)
    // A buffered 2xx is fully materialized — completed. A live stream
    // (SSE/chunked) only proves headers were sent: delivery unverified.
    return {
      outcome: isStreamingResponse(c) ? "unknown" : "handler_completed",
      httpStatus,
    };
  if (httpStatus >= 500) return { outcome: "upstream_error", httpStatus };
  return { outcome: "unknown", httpStatus };
}

export function x402GatewayMiddleware(
  config: X402GatewayMiddlewareConfig,
): MiddlewareHandler {
  const { service, registry } = config;
  const emitFulfillment = config.emitFulfillment ?? emitX402Fulfillment;

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

    // Audit F-2 (257-R2): verifyAndSettle throws on facilitator/RPC
    // flake — an uncaught throw became a bare 500. Money movement is
    // uncertain at that point, so answer 503 (retryable server state),
    // never 402 (which would tell the client to just pay again).
    let result: Awaited<ReturnType<typeof service.verifyAndSettle>>;
    try {
      result = await service.verifyAndSettle(c, resource, amountAtomic);
    } catch (err) {
      logger.error("x402-gateway: verifyAndSettle threw — payment state uncertain", {
        resource: resource.id,
        error: String(err),
      });
      return errorResponse(
        c,
        503,
        "INTERNAL_ERROR",
        "payment verification unavailable — retry later",
      );
    }
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
    const requestId = service.requestIdFor(c, result);
    let usage: Awaited<ReturnType<X402PaymentService["recordUsage"]>> = null;
    try {
      const agentId = await service.resolveAgentId(result.payer);
      usage = await service.recordUsage({
        settleResult: result,
        resource,
        requestId,
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

    // SLICE-257-6: the handler's own outcome is the fulfillment fact.
    // Emit AFTER next() — never before, and never let it alter what the
    // client gets back (a thrown handler is rethrown after emitting).
    let handlerThrew = false;
    let handlerError: unknown;
    try {
      await next();
    } catch (err) {
      handlerThrew = true;
      handlerError = err;
    }
    if (usage) {
      const { outcome, httpStatus } = classifyFulfillmentOutcome(
        c,
        handlerThrew,
      );
      // Fire-and-forget is a contract on the seam, not just the default
      // impl — a throwing emitter must never alter the paid response.
      try {
        emitFulfillment({ usage, outcome, httpStatus });
      } catch (err) {
        logger.warn("x402-gateway: fulfillment emit threw (ignored)", {
          usageRecordId: usage.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (handlerThrew) throw handlerError;
  };
}
