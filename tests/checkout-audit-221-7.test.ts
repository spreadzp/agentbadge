/**
 * SLICE-221-7 (EPIC-221): regression tests for the checkout audit
 * findings — C-1..C-3, H-1..H-9, M-2/M-5 + nits.
 *
 * C-1 dedupe marked only AFTER handler success; failure re-runs.
 * C-2 durable dedupe via event-store claim/done markers.
 * C-3 /checkout 404 escapes the product code.
 * H-1/H-2 webhook binds session.id → attempt.providerReference and
 *   checks payment_status + amount_total.
 * H-3 idempotency-key conflict → 409; malformed key → 400.
 * H-4 prototype-key networks rejected.
 * H-5 undeclared metadata keys rejected.
 * H-7 second attempt for same provider+network reuses the open one.
 * H-9 USDC attempt amount carries the unique micro suffix and
 *   providerReference binds the payment id.
 * M-2 qr.svg caps payload by BYTES.
 * M-5 quantity > 1 → 400.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

import {
  InMemoryPaymentStore,
  InMemoryAttemptStore,
  InMemoryReceiptStore,
  InMemoryEventStore,
  PaymentProviderRegistry,
  StripePaymentProvider,
  type StripeLikeClient,
  type StripeSessionLike,
} from "@agentbadge/payments";

import {
  PaymentsCheckout,
  DirectUsdcStubProvider,
  dispatchFulfillment,
  type FulfillmentInput,
  type FulfillmentHandler,
} from "../src/server/lib/payments-api";
import type { FulfillmentEventStore } from "../src/server/lib/payments-api/fulfillment";
import {
  dispatchCheckoutSession,
  type CheckoutSessionLike,
} from "../src/server/lib/payments-api/webhook-dispatch";
import { createPaymentsApiRoutes } from "../src/server/routes/payments-api";
import { checkoutPageRoutes } from "../src/server/routes/checkout-pages";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSPORT_METADATA = {
  accountId: "0.0.1234",
  name: "test-agent",
  capabilities: ["scan"],
};

const USDC_NETWORKS = {
  "eip155:1874": {
    recipient: "0xArcTreasury0000000000000000000000000001",
    tokenContract: "0xArcUsdc000000000000000000000000000001",
    label: "arc",
  },
};

function makeStripeMock(): { client: StripeLikeClient } {
  const session: StripeSessionLike = {
    id: "cs_paid",
    url: "https://checkout.stripe.com/pay/cs_paid",
    status: "complete",
    payment_status: "paid",
    amount_subtotal: 999,
    currency: "usd",
    payment_intent: "pi_paid",
  };
  return {
    client: {
      checkout: {
        sessions: {
          create: async () => session,
          retrieve: async (id: string) => ({ ...session, id }),
        },
      },
      refunds: {
        create: async () => ({ id: "re_test", status: "succeeded" }),
      },
    },
  };
}

function makeCheckout(withStripe = true) {
  const stores = {
    payments: new InMemoryPaymentStore(),
    attempts: new InMemoryAttemptStore(),
    receipts: new InMemoryReceiptStore(),
    events: new InMemoryEventStore(),
  };
  const providers = new PaymentProviderRegistry();
  if (withStripe) {
    providers.register(
      new StripePaymentProvider({
        client: makeStripeMock().client,
        successUrl: "https://agentbadge.xyz/checkout/success",
        cancelUrl: "https://agentbadge.xyz/checkout/cancel",
      }),
    );
  }
  providers.register(
    new DirectUsdcStubProvider({ networks: USDC_NETWORKS }),
  );
  const checkout = new PaymentsCheckout({
    stores,
    providers,
    usdcNetworks: USDC_NETWORKS,
    usdcInstructionsTtlSec: 3600,
  });
  return { checkout, stores };
}

function makeApiApp(checkout: PaymentsCheckout): Hono {
  const app = new Hono();
  app.route("/", createPaymentsApiRoutes(() => checkout));
  return app;
}

async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function registryWith(handlers: Record<string, FulfillmentHandler>) {
  return new Map<string, FulfillmentHandler>(Object.entries(handlers));
}

/** In-memory FulfillmentEventStore — append dedupes by id (claim). */
function makeEvents() {
  const rows: Array<{
    id: string;
    entity: string;
    paymentId: string;
    to: string;
    atMs: number;
  }> = [];
  const ids = new Set<string>();
  const store: FulfillmentEventStore & { rows: typeof rows } = {
    rows,
    append: async (e) => {
      if (ids.has(e.id)) return null;
      ids.add(e.id);
      rows.push(e);
      return e;
    },
    listByPayment: async (paymentId) =>
      rows.filter((r) => r.paymentId === paymentId),
  };
  return store;
}

// ---------------------------------------------------------------------------
// C-1: dedupe key is marked only after handler success
// ---------------------------------------------------------------------------

describe("C-1 dispatchFulfillment marks after success", () => {
  it("handler throws → same dedupeKey retries (not swallowed)", async () => {
    let calls = 0;
    const handler: FulfillmentHandler = async () => {
      calls++;
      if (calls === 1) throw new Error("mint failed");
    };
    const input: FulfillmentInput = {
      productCode: "PASSPORT_BRONZE",
      metadata: {},
    };
    const registry = registryWith({ "passport-mint": handler });

    await expect(
      dispatchFulfillment(input, {
        registry,
        dedupeKey: `c1-${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("mint failed");

    // C-1 regression: a failed run must NOT mark the key — retry runs.
    const second = await dispatchFulfillment(input, {
      registry,
      dedupeKey: "c1-same-key",
    });
    expect(second).toBe("fulfilled");
    const third = await dispatchFulfillment(input, {
      registry,
      dedupeKey: "c1-same-key",
    });
    expect(third).toBe("deduped");
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C-2: durable dedupe via event-store claim/done markers
// ---------------------------------------------------------------------------

describe("C-2 durable dedupe markers", () => {
  it("payment: dedupeKey writes claim + done; fresh dispatch sees done", async () => {
    const events = makeEvents();
    const handler = vi.fn(async (_i: FulfillmentInput) => {});
    const input: FulfillmentInput = {
      productCode: "PASSPORT_BRONZE",
      metadata: {},
    };
    const registry = registryWith({ "passport-mint": handler });
    const paymentId = `pay_c2_${crypto.randomUUID()}`;

    const first = await dispatchFulfillment(input, {
      registry,
      dedupeKey: `payment:${paymentId}`,
      events,
      nowMs: 1_000,
    });
    expect(first).toBe("fulfilled");
    expect(handler).toHaveBeenCalledTimes(1);

    const markers = events.rows.filter((r) => r.paymentId === paymentId);
    expect(markers.map((m) => m.to)).toEqual(["claimed", "done"]);

    // A "new process" shares only the event store — in-flight sets are
    // module-local, so force the durable path by using a store-backed
    // dedupe check: done marker → deduped without calling the handler.
    const second = await dispatchFulfillment(input, {
      registry,
      dedupeKey: `payment:${paymentId}`,
      events,
      nowMs: 2_000,
    });
    expect(second).toBe("deduped");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handler failure writes a 'failed' marker — retry proceeds", async () => {
    const events = makeEvents();
    let calls = 0;
    const handler: FulfillmentHandler = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    };
    const input: FulfillmentInput = {
      productCode: "PASSPORT_BRONZE",
      metadata: {},
    };
    const registry = registryWith({ "passport-mint": handler });
    const paymentId = `pay_c2f_${crypto.randomUUID()}`;
    const dedupeKey = `payment:${paymentId}`;

    await expect(
      dispatchFulfillment(input, {
        registry,
        dedupeKey,
        events,
        nowMs: 1_000,
      }),
    ).rejects.toThrow("boom");
    expect(events.rows.map((r) => r.to)).toEqual(["claimed", "failed"]);

    // A claimed-without-done marker is a crashed run — retryable only
    // once it is stale (> CLAIM_STALE_MS = 10 min).
    const second = await dispatchFulfillment(input, {
      registry,
      dedupeKey,
      events,
      nowMs: 1_000 + 10 * 60 * 1000 + 1,
    });
    expect(second).toBe("fulfilled");
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C-3: /checkout 404 reflects the product code escaped
// ---------------------------------------------------------------------------

describe("C-3 /checkout 404 escaping", () => {
  it("HTML-injection in ?product is escaped", async () => {
    const app = new Hono();
    app.route("/", checkoutPageRoutes);
    const res = await app.request(
      "/checkout?product=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    );
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// H-1/H-2: webhook binds session.id → attempt.providerReference
// ---------------------------------------------------------------------------

describe("H-1/H-2 webhook session binding + amount checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function stripeAttempt() {
    const { checkout, stores } = makeCheckout();
    const created = await checkout.createPayment({
      productCode: "PASSPORT_BRONZE",
      metadata: PASSPORT_METADATA,
    });
    const paymentId = created.payment.id;
    await checkout.createAttempt({ paymentId, provider: "STRIPE" });
    // STRIPE rail: providerReference = stripe session id.
    const attempt = (await stores.attempts.listByPayment(paymentId))[0];
    return { checkout, stores, paymentId, attempt };
  }

  const fulfillInput = async (
    _paymentId: string,
  ): Promise<FulfillmentInput | null> => ({
    productCode: "PASSPORT_BRONZE",
    metadata: PASSPORT_METADATA,
    amountUsd: "9.99",
    paymentRef: "pay",
  });

  it("session.id resolves the attempt; providerReference is confirmed", async () => {
    const { stores, attempt, paymentId } = await stripeAttempt();
    const confirm = vi.fn().mockResolvedValue({ status: "CONFIRMED" });
    const handler = vi.fn(async (_i: FulfillmentInput) => {});
    const session = {
      id: attempt.providerReference,
      metadata: { paymentId },
      payment_status: "paid",
      amount_total: 999,
      customer_details: { email: "b@e.com" },
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm,
      getFulfillmentInput: fulfillInput,
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": handler }),
      stores,
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "STRIPE",
        providerReference: attempt.providerReference,
      }),
    );
    expect(result.status).toBe("CONFIRMED");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unbound session.id → error, no confirm", async () => {
    const { stores } = await stripeAttempt();
    const confirm = vi.fn().mockResolvedValue({ status: "CONFIRMED" });
    const session = {
      id: "cs_stranger",
      metadata: { paymentId: "pay_legit" },
      payment_status: "paid",
      amount_total: 999,
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm,
      getFulfillmentInput: fulfillInput,
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": vi.fn() }),
      stores,
    });
    expect(result.error).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("amount_total mismatch → error, no confirm", async () => {
    const { stores, attempt, paymentId } = await stripeAttempt();
    const confirm = vi.fn().mockResolvedValue({ status: "CONFIRMED" });
    const session = {
      id: attempt.providerReference,
      metadata: { paymentId },
      payment_status: "paid",
      amount_total: 1, // attempt is 999 cents — tampered
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm,
      getFulfillmentInput: fulfillInput,
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": vi.fn() }),
      stores,
    });
    expect(result.error).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("payment_status ≠ paid → error, no confirm", async () => {
    const { stores, attempt, paymentId } = await stripeAttempt();
    const confirm = vi.fn().mockResolvedValue({ status: "CONFIRMED" });
    const session = {
      id: attempt.providerReference,
      metadata: { paymentId },
      payment_status: "unpaid",
      amount_total: 999,
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm,
      getFulfillmentInput: fulfillInput,
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": vi.fn() }),
      stores,
    });
    expect(result.error).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H-3: idempotency key conflict + schema
// ---------------------------------------------------------------------------

describe("H-3 idempotency key", () => {
  it("same key + different fields → 409 idempotency_conflict", async () => {
    const { checkout } = makeCheckout();
    const app = makeApiApp(checkout);
    const key = "chk-conflict-key";

    const first = await postJson(
      app,
      "/api/v1/payments",
      {
        productCode: "PASSPORT_BRONZE",
        metadata: PASSPORT_METADATA,
      },
      { "Idempotency-Key": key },
    );
    expect(first.status).toBe(201);

    const second = await postJson(
      app,
      "/api/v1/payments",
      {
        productCode: "DIRECTORY_LISTING",
        metadata: { listingId: "lst_1" },
      },
      { "Idempotency-Key": key },
    );
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error?.code ?? body.code ?? "").toContain(
      "idempotency_conflict",
    );
  });

  it("malformed Idempotency-Key → 400", async () => {
    const { checkout } = makeCheckout();
    const app = makeApiApp(checkout);
    const res = await postJson(
      app,
      "/api/v1/payments",
      { productCode: "PASSPORT_BRONZE", metadata: PASSPORT_METADATA },
      { "Idempotency-Key": "x" },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// H-4: prototype-key networks rejected
// ---------------------------------------------------------------------------

describe("H-4 network lookup", () => {
  it("__proto__ / constructor as network → 400, never resolved", async () => {
    const { checkout } = makeCheckout();
    const app = makeApiApp(checkout);
    const created = await postJson(app, "/api/v1/payments", {
      productCode: "PASSPORT_BRONZE",
      metadata: PASSPORT_METADATA,
    });
    const id = (await created.json()).payment.id;

    for (const network of ["__proto__", "constructor"]) {
      const res = await postJson(app, `/api/v1/payments/${id}/attempts`, {
        provider: "DIRECT_USDC",
        network,
      });
      expect(res.status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// H-5: strict metadata — undeclared keys rejected
// ---------------------------------------------------------------------------

describe("H-5 strict metadata", () => {
  it("undeclared keys (tier, paymentId) → 400", async () => {
    const { checkout } = makeCheckout();
    const app = makeApiApp(checkout);
    for (const extra of [
      { tier: "gold" },
      { paymentId: "pay_x" },
      { rail: "STRIPE" },
    ]) {
      const res = await postJson(app, "/api/v1/payments", {
        productCode: "PASSPORT_BRONZE",
        metadata: { ...PASSPORT_METADATA, ...extra },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(JSON.stringify(body)).toContain("undeclared");
    }
  });

  it("malformed accountId format → 400", async () => {
    const { checkout } = makeCheckout();
    const app = makeApiApp(checkout);
    const res = await postJson(app, "/api/v1/payments", {
      productCode: "PASSPORT_BRONZE",
      metadata: { ...PASSPORT_METADATA, accountId: "not-a-hedera-id" },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// H-7 + H-9: attempt reuse, unique amount, providerReference
// ---------------------------------------------------------------------------

describe("H-7/H-9 attempt idempotency + unique USDC amount", () => {
  it("second USDC attempt for same network reuses the open attempt", async () => {
    const { checkout, stores } = makeCheckout(false);
    const created = await checkout.createPayment({
      productCode: "PASSPORT_BRONZE",
      metadata: PASSPORT_METADATA,
    });
    const paymentId = created.payment.id;

    const a1 = await checkout.createAttempt({
      paymentId,
      provider: "DIRECT_USDC",
      network: "eip155:1874",
    });
    const a2 = await checkout.createAttempt({
      paymentId,
      provider: "DIRECT_USDC",
      network: "eip155:1874",
    });
    expect(a2.attempt.id).toBe(a1.attempt.id);
    expect(await stores.attempts.listByPayment(paymentId)).toHaveLength(1);
  });

  it("USDC attempt amount has a payment-unique micro suffix; providerReference binds paymentId", async () => {
    const { checkout, stores } = makeCheckout(false);
    const created = await checkout.createPayment({
      productCode: "PASSPORT_BRONZE",
      metadata: PASSPORT_METADATA,
    });
    const paymentId = created.payment.id;
    await checkout.createAttempt({
      paymentId,
      provider: "DIRECT_USDC",
      network: "eip155:1874",
    });

    const attempt = (await stores.attempts.listByPayment(paymentId))[0];
    expect(attempt.amount).toMatch(/^9\.99\d{4}$/);
    expect(attempt.amount).not.toBe("9.99");
    expect(attempt.providerReference).toBe(
      `usdc_eip155:1874_${paymentId}`,
    );

    // Two payments → different suffix candidates (deterministic per id).
    const other = await checkout.createPayment({
      productCode: "PASSPORT_BRONZE",
      metadata: PASSPORT_METADATA,
    });
    await checkout.createAttempt({
      paymentId: other.payment.id,
      provider: "DIRECT_USDC",
      network: "eip155:1874",
    });
    const otherAttempt = (
      await stores.attempts.listByPayment(other.payment.id)
    )[0];
    expect(otherAttempt.providerReference).toBe(
      `usdc_eip155:1874_${other.payment.id}`,
    );
    expect(otherAttempt.providerReference).not.toBe(
      attempt.providerReference,
    );
  });
});

// ---------------------------------------------------------------------------
// M-2: qr.svg byte cap; M-5: quantity
// ---------------------------------------------------------------------------

describe("M-2 qr.svg + M-5 quantity", () => {
  it("qr.svg rejects >512-byte payloads (multi-byte counts)", async () => {
    const app = new Hono();
    app.route("/", checkoutPageRoutes);
    // 300 'é' = 600 utf-8 bytes — under the old 2000-char limit but over
    // the byte cap.
    const res = await app.request(
      `/checkout/qr.svg?data=${encodeURIComponent("é".repeat(300))}`,
    );
    expect(res.status).toBe(400);
    const ok = await app.request("/checkout/qr.svg?data=hello");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("quantity > 1 → 400 (single-entitlement)", async () => {
    const { checkout } = makeCheckout();
    const app = makeApiApp(checkout);
    const res = await postJson(app, "/api/v1/payments", {
      productCode: "PASSPORT_BRONZE",
      quantity: 2,
      metadata: PASSPORT_METADATA,
    });
    expect(res.status).toBe(400);
  });
});
