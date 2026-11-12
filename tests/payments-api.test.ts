/**
 * SLICE-221-2 (EPIC-221, D-221-1/D-221-6/D-221-8): Payments API
 * `/api/v1/payments*` + DIRECT_USDC instructions stub.
 *
 * AC1: POST /payments → PENDING payment, decimal-string amount;
 *      invalid metadata → 400 (before create).
 * AC2: POST /:id/attempts STRIPE → redirectUrl;
 *      DIRECT_USDC → instructions with server-side network/recipient.
 * AC3: USDC instructions never accept client recipient/tokenContract.
 * AC4: GET /payments/:id + /receipt return correct statuses.
 * AC5: FakeProvider / Stripe mock; no live rails.
 */
import { describe, it, expect, beforeEach } from "vitest";
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
  type UsdcNetworks,
} from "../src/server/lib/payments-api";
import { createPaymentsApiRoutes } from "../src/server/routes/payments-api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSPORT_METADATA = {
  accountId: "0.0.1234",
  name: "test-agent",
  capabilities: ["scan"],
};

const USDC_NETWORKS: UsdcNetworks = {
  "eip155:1874": {
    recipient: "0xArcTreasury0000000000000000000000000001",
    tokenContract: "0xArcUsdc000000000000000000000000000001",
    label: "arc",
  },
  "eip155:84532": {
    recipient: "0xBaseTreasury00000000000000000000000001",
    tokenContract: "0xBaseUsdc0000000000000000000000000001",
    label: "base",
  },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": {
    recipient: "SolTreasury111111111111111111111111111111",
    tokenContract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    label: "solana",
  },
};

const ARC_NETWORK = "eip155:1874";
const BASE_NETWORK = "eip155:84532";
const SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** Controllable Stripe mock — queue scripted session responses. */
function makeStripeMock(session: StripeSessionLike): {
  client: StripeLikeClient;
  created: unknown[];
} {
  const created: unknown[] = [];
  const client: StripeLikeClient = {
    checkout: {
      sessions: {
        create: async (params) => {
          created.push(params);
          return session;
        },
        retrieve: async (id) => ({ ...session, id }),
      },
    },
    refunds: {
      create: async () => ({ id: "re_test", status: "succeeded" }),
    },
  };
  return { client, created };
}

function makeCheckout(opts?: {
  stripe?: StripeLikeClient;
  usdcNetworks?: UsdcNetworks;
}) {
  const stores = {
    payments: new InMemoryPaymentStore(),
    attempts: new InMemoryAttemptStore(),
    receipts: new InMemoryReceiptStore(),
    events: new InMemoryEventStore(),
  };
  const registry = new PaymentProviderRegistry();
  if (opts?.stripe) {
    registry.register(
      new StripePaymentProvider({
        client: opts.stripe,
        successUrl: "https://agentbadge.xyz/checkout/success",
        cancelUrl: "https://agentbadge.xyz/checkout/cancel",
      }),
    );
  }
  const usdcNetworks = opts?.usdcNetworks ?? USDC_NETWORKS;
  registry.register(
    new DirectUsdcStubProvider({ networks: usdcNetworks }),
  );
  const checkout = new PaymentsCheckout({
    stores,
    providers: registry,
    usdcNetworks,
    usdcInstructionsTtlSec: 3600,
  });
  return { checkout, stores };
}

function makeApp(checkout: PaymentsCheckout): Hono {
  const app = new Hono();
  app.route("/", createPaymentsApiRoutes(() => checkout));
  return app;
}

async function postJson(app: Hono, path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function createPassportPayment(app: Hono, headers?: Record<string, string>) {
  return postJson(
    app,
    "/api/v1/payments",
    {
      productCode: "PASSPORT_BRONZE",
      quantity: 1,
      metadata: { ...PASSPORT_METADATA },
    },
    headers,
  );
}

/* ------------------------------- create ------------------------------- */

describe("POST /api/v1/payments", () => {
  let app: Hono;
  beforeEach(() => {
    const { checkout } = makeCheckout({});
    app = makeApp(checkout);
  });

  it("creates a PENDING payment with decimal-string amount from catalog price", async () => {
    const res = await createPassportPayment(app);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.payment.status).toBe("PENDING");
    expect(body.payment.amount).toMatch(/^(0|[1-9]\d*)\.\d{2}$/);
    expect(body.payment.currency).toBe("USD");
    expect(body.payment.id).toMatch(/^pay_/);
    expect(body.payment.productCode).toBe("PASSPORT_BRONZE");
  });

  it("quantity > 1 → 400 invalid_quantity (M-5 single-entitlement)", async () => {
    const res = await postJson(app, "/api/v1/payments", {
      productCode: "DIRECTORY_LISTING",
      quantity: 3,
      metadata: { listingId: "lst_1" },
    });
    expect(res.status).toBe(400);
  });

  it("400 on metadata failing product schema — before any row exists", async () => {
    const res = await postJson(app, "/api/v1/payments", {
      productCode: "PASSPORT_BRONZE",
      quantity: 1,
      metadata: { name: "no-account-id" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_metadata");
    expect(JSON.stringify(body)).toContain("accountId");
  });

  it("400 on unknown productCode", async () => {
    const res = await postJson(app, "/api/v1/payments", {
      productCode: "NOPE",
      quantity: 1,
      metadata: {},
    });
    expect(res.status).toBe(400);
  });

  it("400 on non-integer quantity", async () => {
    const res = await postJson(app, "/api/v1/payments", {
      productCode: "PASSPORT_BRONZE",
      quantity: 1.5,
      metadata: { ...PASSPORT_METADATA },
    });
    expect(res.status).toBe(400);
  });

  it("Idempotency-Key dedupes: second create returns the same payment", async () => {
    const key = "chk-idem-1";
    const first = await createPassportPayment(app, { "Idempotency-Key": key });
    const second = await createPassportPayment(app, { "Idempotency-Key": key });
    expect(first.status).toBe(201);
    const a = await first.json();
    const b = await second.json();
    expect(b.payment.id).toBe(a.payment.id);
    expect(b.deduped).toBe(true);
  });
});

/* ------------------------------- attempts ------------------------------ */

describe("POST /api/v1/payments/:id/attempts", () => {
  it("STRIPE → attempt PENDING + redirectUrl to checkout session", async () => {
    const { client: stripe } = makeStripeMock({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/pay/cs_test_1",
      status: "open",
      payment_status: "unpaid",
    });
    const { checkout, stores } = makeCheckout({ stripe });
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();

    const res = await postJson(app, `/api/v1/payments/${created.payment.id}/attempts`, {
      provider: "STRIPE",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attempt.provider).toBe("STRIPE");
    expect(body.attempt.status).toBe("PENDING");
    expect(body.redirectUrl).toBe("https://checkout.stripe.com/pay/cs_test_1");
    // payment moved to PROCESSING after rail submission
    const row = await stores.payments.getById(created.payment.id);
    expect(row?.status).toBe("PROCESSING");
  });

  it("DIRECT_USDC default network → Arc instructions, server-side recipient/token", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();

    const res = await postJson(app, `/api/v1/payments/${created.payment.id}/attempts`, {
      provider: "DIRECT_USDC",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attempt.provider).toBe("DIRECT_USDC");
    expect(body.attempt.status).toBe("PENDING");
    expect(body.paymentInstructions.network).toBe(ARC_NETWORK);
    expect(body.paymentInstructions.asset).toBe("USDC");
    expect(body.paymentInstructions.recipient).toBe(
      USDC_NETWORKS[ARC_NETWORK].recipient,
    );
    expect(body.paymentInstructions.tokenContract).toBe(
      USDC_NETWORKS[ARC_NETWORK].tokenContract,
    );
    expect(body.paymentInstructions.reference).toBe(created.payment.id);
    // H-9: USDC amount carries the payment-unique micro suffix.
    expect(body.paymentInstructions.amount).toMatch(/^9\.99\d{4}$/);
    expect(body.paymentInstructions.expiresAt).toBeTruthy();
  });

  it("DIRECT_USDC network:base → Base instructions", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();

    const res = await postJson(app, `/api/v1/payments/${created.payment.id}/attempts`, {
      provider: "DIRECT_USDC",
      network: BASE_NETWORK,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.paymentInstructions.network).toBe(BASE_NETWORK);
    expect(body.paymentInstructions.recipient).toBe(
      USDC_NETWORKS[BASE_NETWORK].recipient,
    );
  });

  it("DIRECT_USDC network:solana → solana mint tokenContract", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();

    const res = await postJson(app, `/api/v1/payments/${created.payment.id}/attempts`, {
      provider: "DIRECT_USDC",
      network: SOLANA_NETWORK,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.paymentInstructions.tokenContract).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(body.paymentInstructions.recipient).toBe(
      USDC_NETWORKS[SOLANA_NETWORK].recipient,
    );
  });

  it("rejects client-supplied recipient/token — server config only (spec invariant)", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();
    const id = created.payment.id;

    for (const extra of [
      { recipient: "0xdeadbeef" },
      { tokenContract: "0xdeadbeef" },
      { token: "0xdeadbeef" },
    ]) {
      const res = await postJson(app, `/api/v1/payments/${id}/attempts`, {
        provider: "DIRECT_USDC",
        ...extra,
      });
      expect(res.status).toBe(400);
    }
  });

  it("400 when network is passed for STRIPE", async () => {
    const { client: stripe } = makeStripeMock({ id: "cs_x", url: "u" });
    const { checkout } = makeCheckout({ stripe });
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();

    const res = await postJson(app, `/api/v1/payments/${created.payment.id}/attempts`, {
      provider: "STRIPE",
      network: BASE_NETWORK,
    });
    expect(res.status).toBe(400);
  });

  it("400 on unknown provider / unsupported network; 404 on unknown payment", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();
    const id = created.payment.id;

    expect(
      (await postJson(app, `/api/v1/payments/${id}/attempts`, { provider: "PAYPAL" }))
        .status,
    ).toBe(400);
    expect(
      (
        await postJson(app, `/api/v1/payments/${id}/attempts`, {
          provider: "DIRECT_USDC",
          network: "eip155:999999",
        })
      ).status,
    ).toBe(400);
    expect(
      (await postJson(app, "/api/v1/payments/pay_missing/attempts", { provider: "STRIPE" }))
        .status,
    ).toBe(404);
  });

  it("second attempt allowed while first is non-terminal (latest wins)", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();
    const id = created.payment.id;

    const r1 = await postJson(app, `/api/v1/payments/${id}/attempts`, {
      provider: "DIRECT_USDC",
    });
    const r2 = await postJson(app, `/api/v1/payments/${id}/attempts`, {
      provider: "DIRECT_USDC",
      network: BASE_NETWORK,
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const b2 = await r2.json();
    expect(b2.attempt.id).not.toBe((await r1.json()).attempt.id);
  });
});

/* ------------------------------ status/receipt ------------------------- */

describe("GET /api/v1/payments/:id (+receipt)", () => {
  it("GET returns payment + attempts; 404 unknown id", async () => {
    const { checkout } = makeCheckout({});
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();
    const id = created.payment.id;

    await postJson(app, `/api/v1/payments/${id}/attempts`, {
      provider: "DIRECT_USDC",
    });

    const res = await app.request(`/api/v1/payments/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment.id).toBe(id);
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0].provider).toBe("DIRECT_USDC");

    expect((await app.request("/api/v1/payments/pay_nope")).status).toBe(404);
  });

  it("receipt → 404 while unconfirmed; after CONFIRMED attempt self-heals payment", async () => {
    const { client: stripe } = makeStripeMock({
      id: "cs_paid",
      url: "https://checkout.stripe.com/pay/cs_paid",
      status: "complete",
      payment_status: "paid",
      amount_subtotal: 999,
      currency: "usd",
      payment_intent: "pi_paid",
    });
    const { checkout } = makeCheckout({ stripe });
    const app = makeApp(checkout);
    const created = await (await createPassportPayment(app)).json();
    const id = created.payment.id;

    await postJson(app, `/api/v1/payments/${id}/attempts`, {
      provider: "STRIPE",
    });

    // no receipt yet
    expect((await app.request(`/api/v1/payments/${id}/receipt`)).status).toBe(404);

    // polling with provider evidence → CONFIRMED + receipt
    const confirm = await checkout.confirmPayment({ paymentId: id });
    expect(confirm.status).toBe("CONFIRMED");

    const res = await app.request(`/api/v1/payments/${id}/receipt`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.paymentId).toBe(id);
    expect(body.receipt.asset).toBe("USD");
  });
});
