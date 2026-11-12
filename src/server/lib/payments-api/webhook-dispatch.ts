/**
 * Stripe webhook dispatch (SLICE-221-3, D-221-9; hardened in SLICE-221-7).
 *
 *   session.metadata.paymentId → new payments API path:
 *     - H-1: the session is bound to a payment by session.id →
 *       attempt.providerReference (server-created at attempt time), never
 *       by the metadata value alone — a forged paymentId in legacy-session
 *       metadata cannot confirm/dispatch an unrelated payment.
 *     - H-2: `payment_status === "paid"` and `amount_total` vs the
 *       attempt's expected amount are verified before confirming.
 *   otherwise (legacy session with productId) → fulfillOrder unchanged.
 *
 * H-6: every non-fulfilling branch is logged; missing fulfillment input,
 * missing handler, unbound sessions, and transiently-unconfirmed payments
 * return `error` so the route answers 5xx → Stripe retries.
 *
 * Signature verification + event-type filtering stay in the route; this
 * receives the verified checkout.session object only.
 */

import type {
  ConfirmPaymentInput,
  ConfirmPaymentOutcome,
  PaymentServiceStores,
} from "@agentbadge/payments";

import { logger } from "@agentbadge/passport/logger";

import { dispatchFulfillment, type FulfillmentHandler, type FulfillmentInput } from "./fulfillment";
import { usdToCentsInt } from "./money";

/** Structural Stripe checkout session — matches real sessions + mocks. */
export interface CheckoutSessionLike {
  id: string;
  metadata?: Record<string, string> | null;
  payment_status?: string | null;
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
  /** Attempt + event stores — session binding (H-1) and durable
   *  fulfillment dedupe (C-2). Optional for test wiring; when absent the
   *  legacy metadata.paymentId claim is used without binding checks. */
  stores?: PaymentServiceStores;
}

export interface WebhookDispatchResult {
  path: "confirm" | "legacy";
  status?: ConfirmPaymentOutcome["status"];
  /** Set → the route must answer 5xx so Stripe retries the delivery. */
  error?: string;
}

/** Statuses a Stripe retry could still resolve (keep the delivery 5xx). */
const RETRYABLE = new Set<ConfirmPaymentOutcome["status"]>([
  "PENDING",
  "UNKNOWN",
]);

function alert(
  event: string,
  details: Record<string, unknown>,
): void {
  logger.error(`webhook-dispatch: ${event}`, details);
}

export async function dispatchCheckoutSession(
  session: CheckoutSessionLike,
  deps: WebhookDispatchDeps,
): Promise<WebhookDispatchResult> {
  const claimedPaymentId = session.metadata?.paymentId;
  if (!claimedPaymentId) {
    await deps.fulfillLegacy(session);
    return { path: "legacy" };
  }

  // H-1: bind the session to a payment attempt through the
  // server-generated providerReference (session.id), not the
  // client-controlled metadata claim.
  const attempt = deps.stores
    ? await deps.stores.attempts.getByProviderRef("STRIPE", session.id)
    : null;
  if (deps.stores && !attempt) {
    alert("session is not bound to any payment attempt", {
      sessionId: session.id,
      claimedPaymentId,
    });
    return {
      path: "confirm",
      status: "UNKNOWN",
      error: "checkout session is not bound to a payment attempt",
    };
  }
  const paymentId = attempt?.paymentId ?? claimedPaymentId;
  if (attempt && attempt.paymentId !== claimedPaymentId) {
    alert("session paymentId mismatch — using attempt binding", {
      sessionId: session.id,
      claimedPaymentId,
      boundPaymentId: attempt.paymentId,
    });
  }

  // H-2: completed events must be paid, for the expected amount.
  if (session.payment_status && session.payment_status !== "paid") {
    alert("session completed without payment_status=paid", {
      sessionId: session.id,
      paymentId,
      paymentStatus: session.payment_status,
    });
    return {
      path: "confirm",
      status: "PENDING",
      error: `session ${session.id} payment_status=${session.payment_status}`,
    };
  }
  if (
    attempt &&
    typeof session.amount_total === "number" &&
    session.amount_total !== usdToCentsInt(attempt.amount)
  ) {
    alert("session amount_total does not match attempt amount", {
      sessionId: session.id,
      paymentId,
      amountTotal: session.amount_total,
      expectedCents: usdToCentsInt(attempt.amount),
    });
    return {
      path: "confirm",
      status: "DISPUTED",
      error: "session amount does not match the bound payment",
    };
  }

  const confirmInput: ConfirmPaymentInput = deps.stores
    ? {
        provider: "STRIPE",
        providerReference: session.id,
        actor: "stripe-webhook",
      }
    : { paymentId, actor: "stripe-webhook" };
  const outcome = await deps.confirm(confirmInput);
  if (outcome.status !== "CONFIRMED") {
    const retryable = RETRYABLE.has(outcome.status);
    if (retryable) {
      logger.warn("webhook-dispatch: payment not confirmed yet", {
        sessionId: session.id,
        paymentId,
        status: outcome.status,
        reason: outcome.reason,
      });
    } else {
      alert("payment reached terminal non-confirm status", {
        sessionId: session.id,
        paymentId,
        status: outcome.status,
        reason: outcome.reason,
      });
    }
    return {
      path: "confirm",
      status: outcome.status,
      error: retryable
        ? `payment ${paymentId} not confirmed (${outcome.status})`
        : undefined,
    };
  }

  const input = await deps.getFulfillmentInput(paymentId);
  if (!input) {
    alert("CONFIRMED payment has no fulfillment input", {
      sessionId: session.id,
      paymentId,
    });
    return {
      path: "confirm",
      status: outcome.status,
      error: `fulfillment input missing for payment ${paymentId}`,
    };
  }

  // O2: session email is the buyer reference for Stripe checkouts.
  input.buyerRef =
    session.customer_details?.email ??
    session.customer_email ??
    input.buyerRef;
  if (input.buyerRef?.includes("@")) {
    input.email = input.buyerRef;
  }
  input.paymentRef = paymentId;

  const dispatched = await dispatchFulfillment(input, {
    dedupeKey: `payment:${paymentId}`,
    registry: deps.registry,
    events: deps.stores?.events,
  });
  if (dispatched === "no-handler") {
    alert("CONFIRMED payment has no fulfillment handler", {
      sessionId: session.id,
      paymentId,
      productCode: input.productCode,
    });
    return {
      path: "confirm",
      status: outcome.status,
      error: `no fulfillment handler for ${input.productCode}`,
    };
  }
  return { path: "confirm", status: outcome.status };
}
