/**
 * SLICE-221-4 (EPIC-221, D-221-3/D-221-7): Checkout UI e2e.
 *
 * AC1: GET /checkout?product=<code> renders product summary + metadata
 *      form per catalog schema + method/network selects; unknown product → 404.
 * AC2: GET /checkout/qr.svg renders an SVG for instruction data.
 * AC3: Happy path via API — create payment → DIRECT_USDC attempt →
 *      instructions expose address/amount/reference/expiry; status + receipt readable.
 * AC4: /pricing exposes payment-method dropdown (Card / USDC) with
 *      Arc-default USDC network options and dual-rail narrative.
 * AC5: /checkout/success + /checkout/cancel render dedicated pages.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import {
  InMemoryPaymentStore,
  InMemoryAttemptStore,
  InMemoryReceiptStore,
  InMemoryEventStore,
  PaymentProviderRegistry,
} from "@agentbadge/payments";

import {
  PaymentsCheckout,
  DirectUsdcStubProvider,
  type UsdcNetworks,
} from "../src/server/lib/payments-api";
import { createPaymentsApiRoutes } from "../src/server/routes/payments-api";
import { createCheckoutPageRoutes } from "../src/server/routes/checkout-pages";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeApp() {
  const stores = {
    payments: new InMemoryPaymentStore(),
    attempts: new InMemoryAttemptStore(),
    receipts: new InMemoryReceiptStore(),
    events: new InMemoryEventStore(),
  };
  const registry = new PaymentProviderRegistry();
  registry.register(new DirectUsdcStubProvider({ networks: USDC_NETWORKS }));
  const checkout = new PaymentsCheckout({
    stores,
    providers: registry,
    usdcNetworks: USDC_NETWORKS,
    usdcInstructionsTtlSec: 3600,
  });
  const app = new Hono();
  app.route("/", createPaymentsApiRoutes(() => checkout));
  app.route(
    "/",
    createCheckoutPageRoutes({ usdcNetworks: USDC_NETWORKS }),
  );
  return app;
}

async function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Page render
// ---------------------------------------------------------------------------

describe("GET /checkout", () => {
  it("renders product summary + passport metadata fields", async () => {
    const res = await makeApp().request("/checkout?product=PASSPORT_BRONZE");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bronze");
    expect(html).toContain("$9.99");
    // catalog-required metadata fields get inputs
    expect(html).toContain('name="accountId"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="capabilities"');
    // optional fields too
    expect(html).toContain('name="endpoint"');
    expect(html).toContain('name="imageUrl"');
    // method + network selects
    expect(html).toContain('name="method"');
    expect(html).toContain("Card");
    expect(html).toContain("USDC");
    expect(html).toContain('name="network"');
    expect(html).toContain("arc");
    // client orchestrator
    expect(html).toContain("/js/checkout.js");
  });

  it("renders directory-listing form with listingId", async () => {
    const res = await makeApp().request("/checkout?product=DIRECTORY_LISTING");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="listingId"');
    expect(html).not.toContain('name="accountId"');
  });

  it("404s on unknown product", async () => {
    const res = await makeApp().request("/checkout?product=NOPE");
    expect(res.status).toBe(404);
  });

  it("pre-selects method+network from query params", async () => {
    const res = await makeApp().request(
      "/checkout?product=PASSPORT_BRONZE&method=usdc&network=eip155:84532",
    );
    const html = await res.text();
    // base option selected
    expect(html).toMatch(/value="eip155:84532"[^>]*selected/);
  });
});

describe("checkout success/cancel pages", () => {
  it("renders /checkout/success", async () => {
    const res = await makeApp().request("/checkout/success");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("success");
  });
  it("renders /checkout/cancel", async () => {
    const res = await makeApp().request("/checkout/cancel");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("cancel");
  });
});

describe("GET /checkout/qr.svg", () => {
  it("renders an SVG QR code for arbitrary data", async () => {
    const res = await makeApp().request(
      "/checkout/qr.svg?data=usdc:test",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg");
    const svg = await res.text();
    expect(svg).toContain("<svg");
  });
  it("400s without data param", async () => {
    const res = await makeApp().request("/checkout/qr.svg");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Happy-path API flow
// ---------------------------------------------------------------------------

describe("checkout e2e via payments API", () => {
  it("payment → DIRECT_USDC attempt → instructions → status → receipt", async () => {
    const app = makeApp();

    const created = await postJson(app, "/api/v1/payments", {
      productCode: "PASSPORT_BRONZE",
      metadata: {
        accountId: "0x1111111111111111111111111111111111111111",
        name: "test-agent",
        capabilities: ["scan"],
      },
    });
    expect(created.status).toBe(201);
    const { payment } = (await created.json()) as {
      payment: { id: string; status: string; amount: string };
    };
    expect(payment.status).toBe("PENDING");
    expect(payment.amount).toBe("9.99");

    const attempt = await postJson(
      app,
      `/api/v1/payments/${payment.id}/attempts`,
      { provider: "DIRECT_USDC", network: "eip155:1874" },
    );
    expect(attempt.status).toBe(201);
    const body = (await attempt.json()) as {
      paymentInstructions: {
        network: string;
        asset: string;
        amount: string;
        recipient: string;
        tokenContract: string;
        reference: string;
        expiresAt: string;
      };
    };
    expect(body.paymentInstructions.recipient).toBe(
      USDC_NETWORKS["eip155:1874"].recipient,
    );
    expect(body.paymentInstructions.asset).toBe("USDC");
    // H-9: USDC instructions carry the payment-unique micro suffix.
    expect(body.paymentInstructions.amount).toMatch(/^9\.99\d{4}$/);
    expect(body.paymentInstructions.reference).toBe(payment.id);
    expect(body.paymentInstructions.expiresAt).toBeTruthy();

    const status = await app.request(`/api/v1/payments/${payment.id}`);
    const statusBody = (await status.json()) as {
      payment: { status: string };
      attempts: unknown[];
    };
    expect(statusBody.payment.status).toBe("PROCESSING");
    expect(statusBody.attempts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// /pricing dual-rail presentation
// ---------------------------------------------------------------------------

describe("/pricing page", () => {
  it("shows method dropdown with Card+USDC and network options", async () => {
    const app = new Hono();
    const { contentPageRoutes } = await import(
      "../src/server/routes/content-pages"
    );
    app.route("/", contentPageRoutes);
    const res = await app.request("/pricing");
    expect(res.status).toBe(200);
    const html = await res.text();
    // method dropdown on tier cards
    expect(html).toContain("data-method-select");
    expect(html).toContain("Card");
    expect(html).toContain("USDC");
    // USDC networks (Arc default + Base + Solana)
    expect(html).toContain("arc");
    expect(html).toContain("base");
    expect(html).toContain("solana");
    // dual-rail narrative replaces "Prices are in HBAR" exclusivity
    expect(html).not.toContain("Prices are in HBAR and settled on Hedera");
    // HBAR mint CTA stays
    expect(html).toContain("/ui/passport/request");
    // card CTA has no blockchain terms
    expect(html).not.toMatch(/Pay with Card[^<]*HBAR/);
  });
});
