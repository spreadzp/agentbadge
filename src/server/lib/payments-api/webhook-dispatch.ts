/**
 * Stripe webhook dispatch (SLICE-221-3, D-221-9): one endpoint, dispatch
 * by session metadata.
 *
 *   session.metadata.paymentId → PaymentsCheckout.confirmPayment →
 *     on CONFIRMED → fulfillment registry (normalized input)
 *   otherwise (legacy session with productId) → fulfillOrder unchanged.
 *
 * Signature verification + event-type filtering stay in the route; this
 * receives the verified checkout.session object only.
 */

import type {
  ConfirmPaymentInput,
  ConfirmPaymentOutcome,
} from "@agentbadge/payments";

import {
  dispatchFulfillment,
  type FulfillmentHandler,
  type FulfillmentInput,
} from "./fulfillment";

/** Structural Stripe checkout session — matches real sessions + mocks. */
export interface CheckoutSessionLike {
  id: string;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  amount_total?: number | null;
}

export interface WebhookDispatchDeps {
  confirm: (input: ConfirmPaymentInput) => Promise<ConfirmPaymentOutcome>;
  /** payment row → normalized fulfillment input (productCode+metadata). */
  getFulfillmentInput: (
    paymentId: string,
  ) => Promise<FulfillmentInput | null>;
  /** Legacy path — order-fulfillment.fulfillOrder. */
  fulfillLegacy: (session: CheckoutSessionLike) => Promise<void>;
  registry?: Map<string, FulfillmentHandler>;
}

export interface WebhookDispatchResult {
  path: "confirm" | "legacy";
  status?: ConfirmPaymentOutcome["status"];
}

export async function dispatchCheckoutSession(
  session: CheckoutSessionLike,
  deps: WebhookDispatchDeps,
): Promise<WebhookDispatchResult> {
  const paymentId = session.metadata?.paymentId;
  if (!paymentId) {
    await deps.fulfillLegacy(session);
    return { path: "legacy" };
  }

  const outcome = await deps.confirm({
    paymentId,
    actor: "stripe-webhook",
  });
  if (outcome.status !== "CONFIRMED") {
    return { path: "confirm", status: outcome.status };
  }

  const input = await deps.getFulfillmentInput(paymentId);
  if (input) {
    // O2: session email is the buyer reference for Stripe checkouts.
    input.buyerRef =
      session.customer_details?.email ??
      session.customer_email ??
      input.buyerRef;
    input.email = input.buyerRef;
    input.paymentRef = paymentId;
    await dispatchFulfillment(input, {
      dedupeKey: `payment:${paymentId}`,
      registry: deps.registry,
    });
  }
  return { path: "confirm", status: outcome.status };
}
