/**
 * SLICE-223-3: x402 protocol adapter (D-223-5, D-223-7).
 *
 * ALL PAYMENT-* header encode/decode goes through the official
 * `@x402/core/http` helpers — no hand-rolled base64. The seam
 * (x402-settle-seam.ts) remains the verify+settle authority; this
 * module only speaks protocol headers and adapts domain types.
 */

import type { Context, MiddlewareHandler } from "hono";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  ResourceInfo,
  SettleResponse,
} from "@x402/core/types";
import type { PaidResource } from "@agentbadge/payments";
import { usdToUsdcAtomic } from "@agentbadge/payments";

import { errorResponse } from "../error-response.js";
import type { SettleSeamResult } from "../x402-settle-seam.js";
import type {
  GatewayPaymentRequirements,
  X402PaymentRequirements as X402AcceptEntry,
} from "./types.js";

export const X402_VERSION = 2;

/** Hono context key carrying the settled payment for downstream code. */
export const X402_PAYMENT_KEY = "x402Payment";

// ---------- headers (official encoders only) ----------

export interface PaymentRequiredInit {
  accepts: X402AcceptEntry[];
  resource: ResourceInfo;
  /** Optional error string the client should surface. */
  error?: string;
  extensions?: Record<string, unknown>;
}

/** PAYMENT-REQUIRED header value for an HTTP 402 response. */
export function paymentRequiredHeader(init: PaymentRequiredInit): string {
  const required: PaymentRequired = {
    x402Version: X402_VERSION,
    ...(init.error ? { error: init.error } : {}),
    resource: init.resource,
    accepts: init.accepts,
    ...(init.extensions ? { extensions: init.extensions } : {}),
  };
  return encodePaymentRequiredHeader(required);
}

/**
 * Decode the client's `PAYMENT-SIGNATURE` header. Malformed or absent
 * input → null (callers treat it as "no payment" and re-402).
 */
export function parsePaymentSignature(
  header: string | undefined | null,
): PaymentPayload | null {
  if (!header) return null;
  try {
    const payload = decodePaymentSignatureHeader(header);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/** PAYMENT-RESPONSE header value for a successful settle. */
export function paymentResponseHeader(settle: SettleResponse): string {
  return encodePaymentResponseHeader(settle);
}

// ---------- domain ↔ protocol adapters ----------

/** Seam result → protocol SettleResponse (always success — the seam
 *  only returns a result when settlement succeeded). */
export function settleResponseFrom(r: SettleSeamResult): SettleResponse {
  return {
    success: true,
    payer: r.payer,
    transaction: r.tx ?? "",
    network: (r.sourceChain ?? "") as Network,
    amount: r.amountAtomic,
  };
}

export interface AcceptEntryOpts {
  /** x402 scheme — "exact" for one-shot USDC. */
  scheme: string;
  /** Token identifier (e.g. ARC_USDC contract or CAIP-19). */
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

/** Domain PaymentRequirements → one protocol `accepts` entry. */
export function domainToAcceptEntry(
  req: GatewayPaymentRequirements,
  opts: AcceptEntryOpts,
): X402AcceptEntry {
  return {
    scheme: opts.scheme,
    network: req.network as Network,
    asset: opts.asset,
    amount: req.amount,
    payTo: req.recipient,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 60,
    extra: {
      resourceId: req.resourceId,
      currency: req.currency,
      description: req.description,
      ...(opts.extra ?? {}),
    },
  };
}

// ---------- thin middleware ----------

export interface X402GatewayDeps {
  /** Registry lookup — null = resource not configured (500). */
  getResource(id: string): PaidResource | null;
  /**
   * Protocol accepts for an atomic amount — bridge to
   * `router.acceptsFor(amount)` so advertised rails stay router-owned
   * (D-223-4: the router is the single source for supported schemes).
   */
  acceptsFor(
    resource: PaidResource,
    amountAtomic: string,
  ): X402AcceptEntry[];
  /** Existing seam — verify+settle authority (D-223-7). null = it
   *  already stamped PAYMENT-REQUIRED on the context. */
  seam: (c: Context) => Promise<SettleSeamResult | null>;
  /** Post-settle hook — SLICE-223-4 wires the UsageRecord write here. */
  onSettled?: (
    c: Context,
    r: SettleSeamResult,
    resource: PaidResource,
  ) => void | Promise<void>;
  /** Bazaar/discovery extensions merged into PaymentRequired. */
  extensions?: Record<string, unknown>;
}

/**
 * `x402Middleware(resourceId, deps)` — thin gate per SLICE-223-3:
 * no payment header → spec-compliant 402 via the official encoder;
 * header present → hand off to the seam; settled → PAYMENT-RESPONSE
 * header + `x402Payment` context value + `onSettled` hook.
 * The full registry/resolver/usage-record flow lands in 223-4.
 */
export function x402Middleware(
  resourceId: string,
  deps: X402GatewayDeps,
): MiddlewareHandler {
  return async (c, next) => {
    const resource = deps.getResource(resourceId);
    if (!resource || !resource.enabled) {
      return errorResponse(
        c,
        500,
        "INTERNAL_ERROR",
        `x402 gateway resource not configured: ${resourceId}`,
      );
    }

    if (!c.req.header("payment-signature")) {
      const amountAtomic = usdToUsdcAtomic(resource.priceUsd);
      c.header(
        "PAYMENT-REQUIRED",
        paymentRequiredHeader({
          accepts: deps.acceptsFor(resource, amountAtomic),
          resource: {
            url: c.req.url,
            description: resource.description,
            mimeType: "application/json",
          },
          extensions: deps.extensions,
        }),
      );
      return errorResponse(
        c,
        402,
        "PAYMENT_REQUIRED",
        "Payment required for this resource",
      );
    }

    const result = await deps.seam(c);
    if (!result) {
      // Seam already stamped PAYMENT-REQUIRED — propagate the 402.
      return errorResponse(
        c,
        402,
        "PAYMENT_REQUIRED",
        "Payment verification failed",
      );
    }

    c.set(X402_PAYMENT_KEY, result);
    c.header("PAYMENT-RESPONSE", paymentResponseHeader(settleResponseFrom(result)));
    await deps.onSettled?.(c, result, resource);
    await next();
  };
}
