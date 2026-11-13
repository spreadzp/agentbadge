/**
 * SLICE-221-3 (EPIC-221, D-221-4/D-221-9): Webhook dispatch + fulfillment
 * registry on normalized input.
 *
 * AC1: session.metadata.paymentId → confirmPayment → CONFIRMED → handler once.
 * AC2: no paymentId (legacy productId session) → fulfillOrder unchanged.
 * AC3: duplicate webhook deliveries → no double fulfillment (claim-ledger).
 * AC4: passport mint gets the same fields as before; directory gets listingId.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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
  type UsdcNetworks,
} from "../src/server/lib/payments-api";
import {
  dispatchFulfillment,
  resetFulfillmentRegistry,
  type FulfillmentInput,
  type FulfillmentHandler,
} from "../src/server/lib/payments-api/fulfillment";
import {
  dispatchCheckoutSession,
  type CheckoutSessionLike,
} from "../src/server/lib/payments-api/webhook-dispatch";
import {
  EventLedger,
  withIdempotency,
} from "../src/server/lib/event-ledger";

vi.mock("@agentbadge/passport", () => ({
  issuePassport: vi.fn().mockResolvedValue({
    tokenId: "0.0.999",
    serialNumber: 1,
    did: "did:hcs:0.0.999:1",
    tier: "bronze",
    hashScanLink: "https://hashscan.io/testnet/token/0.0.999/1",
  }),
}));
vi.mock("../src/server/lib/passport-chain-gate", () => ({
  passportChainEnabled: () => true,
}));
vi.mock("../src/server/services/contact.service", () => ({
  sendDiscordMessage: vi.fn().mockResolvedValue(undefined),
}));

import { issuePassport } from "@agentbadge/passport";
import {
  fulfillOrder,
  fulfillPassportMint,
  fulfillDirectoryListing,
  normalizeSession,
  registerDefaultFulfillmentHandlers,
  resetProcessedSessions,
} from "../src/server/lib/order-fulfillment";

const mockedIssuePassport = vi.mocked(issuePassport);

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const USDC_NETWORKS: UsdcNetworks = {};
const PASSPORT_METADATA = {
  accountId: "0x1111111111111111111111111111111111111111",
  name: "test-agent",
  capabilities: ["scan"],
};

function paidStripeMock(): { client: StripeLikeClient } {
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

function makeCheckout() {
  const stores = {
    payments: new InMemoryPaymentStore(),
    attempts: new InMemoryAttemptStore(),
    receipts: new InMemoryReceiptStore(),
    events: new InMemoryEventStore(),
  };
  const providers = new PaymentProviderRegistry();
  providers.register(
    new StripePaymentProvider({
      client: paidStripeMock().client,
      successUrl: "https://agentbadge.xyz/checkout/success",
      cancelUrl: "https://agentbadge.xyz/checkout/cancel",
    }),
  );
  const checkout = new PaymentsCheckout({
    stores,
    providers,
    usdcNetworks: USDC_NETWORKS,
    usdcInstructionsTtlSec: 3600,
  });
  return { checkout, stores };
}

function registryWith(handlers: Record<string, FulfillmentHandler>) {
  return new Map<string, FulfillmentHandler>(Object.entries(handlers));
}

// --------------------------------------------------------------------------
// dispatchCheckoutSession — metadata dispatch (D-221-9)
// --------------------------------------------------------------------------

describe("dispatchCheckoutSession", () => {
  beforeEach(() => {
    resetFulfillmentRegistry();
    resetProcessedSessions();
    vi.clearAllMocks();
  });

  it("metadata.paymentId → confirmPayment; CONFIRMED → fulfillment handler", async () => {
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const confirm = vi
      .fn()
      .mockResolvedValue({ status: "CONFIRMED" });
    const session = {
      id: "cs_1",
      metadata: { paymentId: "pay_1" },
      customer_details: { email: "buyer@example.com" },
      amount_total: 999,
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm,
      getFulfillmentInput: async () => ({
        productCode: "PASSPORT_BRONZE",
        metadata: PASSPORT_METADATA,
        amountUsd: "9.99",
        paymentRef: "pay_1",
      }),
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": handler }),
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: "pay_1" }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    const input = handler.mock.calls[0][0];
    expect(input.productCode).toBe("PASSPORT_BRONZE");
    expect(input.buyerRef).toBe("buyer@example.com");
    expect(input.metadata).toMatchObject({ accountId: "0x1111111111111111111111111111111111111111" });
    expect(result.path).toBe("confirm");
    expect(result.status).toBe("CONFIRMED");
  });

  it("non-CONFIRMED outcome → no fulfillment dispatch", async () => {
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const session = {
      id: "cs_2",
      metadata: { paymentId: "pay_2" },
    } as unknown as CheckoutSessionLike;

    await dispatchCheckoutSession(session, {
      confirm: vi.fn().mockResolvedValue({ status: "PENDING" }),
      getFulfillmentInput: async () => ({
        productCode: "PASSPORT_BRONZE",
        metadata: PASSPORT_METADATA,
      }),
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": handler }),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("no paymentId → legacy fulfillOrder path (D-221-9 unchanged)", async () => {
    const legacy = vi.fn(async () => { });
    const confirm = vi.fn();
    const session = {
      id: "cs_3",
      metadata: { productId: "passport-bronze" },
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm,
      getFulfillmentInput: vi.fn(),
      fulfillLegacy: legacy,
      registry: new Map(),
    });

    expect(legacy).toHaveBeenCalledWith(session);
    expect(confirm).not.toHaveBeenCalled();
    expect(result.path).toBe("legacy");
  });

  it("duplicate delivery via claim-ledger → confirm called once", async () => {
    const ledger = new EventLedger();
    const confirm = vi
      .fn()
      .mockResolvedValue({ status: "CONFIRMED" });
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const session = {
      id: "cs_dup",
      metadata: { paymentId: "pay_dup" },
    } as unknown as CheckoutSessionLike;

    const run = async () => {
      await dispatchCheckoutSession(session, {
        confirm,
        getFulfillmentInput: async () => ({
          productCode: "PASSPORT_BRONZE",
          metadata: PASSPORT_METADATA,
        }),
        fulfillLegacy: vi.fn(),
        registry: registryWith({ "passport-mint": handler }),
      });
    };

    await withIdempotency(ledger, "evt_1", session.id, run);
    // Stripe redelivers: new event id, same session → claim dedupes.
    await withIdempotency(ledger, "evt_2", session.id, run);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("repeated CONFIRMED outcome → handler still once (payment dedupe)", async () => {
    const confirm = vi
      .fn()
      .mockResolvedValue({ status: "CONFIRMED" });
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const session = {
      id: "cs_re",
      metadata: { paymentId: "pay_re" },
    } as unknown as CheckoutSessionLike;
    const deps = {
      confirm,
      getFulfillmentInput: async () => ({
        productCode: "PASSPORT_BRONZE",
        metadata: PASSPORT_METADATA,
      }),
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": handler }),
    };

    // C-3 self-heal path re-runs confirm; dedupeKey must hold handler to once.
    await dispatchCheckoutSession(session, deps);
    const second = { ...session, id: "cs_re_2" } as CheckoutSessionLike;
    await dispatchCheckoutSession(second, deps);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// Full pipeline: checkout → Stripe attempt → webhook confirm → registry
// --------------------------------------------------------------------------

describe("webhook → confirm → fulfillment pipeline", () => {
  beforeEach(() => {
    resetFulfillmentRegistry();
    resetProcessedSessions();
    vi.clearAllMocks();
  });

  it("paymentId webhook confirms the payment and invokes registry handler", async () => {
    const { checkout } = makeCheckout();
    const created = await checkout.createPayment({
      productCode: "PASSPORT_BRONZE",
      metadata: PASSPORT_METADATA,
      idempotencyKey: "wh-pipe",
    });
    const paymentId = created.payment.id;
    await checkout.createAttempt({ paymentId, provider: "STRIPE" });

    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const session = {
      id: "cs_paid",
      metadata: { paymentId },
      customer_details: { email: "buyer@example.com" },
    } as unknown as CheckoutSessionLike;

    const result = await dispatchCheckoutSession(session, {
      confirm: (input) => checkout.confirmPayment(input),
      getFulfillmentInput: (id) => checkout.getFulfillmentInput(id),
      fulfillLegacy: vi.fn(),
      registry: registryWith({ "passport-mint": handler }),
    });

    expect(result.status).toBe("CONFIRMED");
    expect(handler).toHaveBeenCalledTimes(1);
    const input = handler.mock.calls[0][0];
    expect(input.productCode).toBe("PASSPORT_BRONZE");
    expect(input.metadata).toMatchObject({
      accountId: "0x1111111111111111111111111111111111111111",
      tier: "bronze",
    });
    expect(input.buyerRef).toBe("buyer@example.com");
  });
});

// --------------------------------------------------------------------------
// dispatchFulfillment — registry semantics
// --------------------------------------------------------------------------

describe("dispatchFulfillment registry", () => {
  beforeEach(() => {
    resetFulfillmentRegistry();
    vi.clearAllMocks();
  });

  it("resolves handler by fulfillmentKind (catalog productCode)", async () => {
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const registry = registryWith({ "passport-mint": handler });

    await dispatchFulfillment(
      { productCode: "PASSPORT_BRONZE", metadata: {} },
      { registry, dedupeKey: "k1" },
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("same dedupeKey → handler once; different key → runs again", async () => {
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const registry = registryWith({ "passport-mint": handler });
    const input: FulfillmentInput = {
      productCode: "PASSPORT_BRONZE",
      metadata: {},
    };

    await dispatchFulfillment(input, { registry, dedupeKey: "p1" });
    await dispatchFulfillment(input, { registry, dedupeKey: "p1" });
    await dispatchFulfillment(input, { registry, dedupeKey: "p2" });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("no handler for kind → resolves 'no-handler', nothing thrown", async () => {
    const ok = await dispatchFulfillment(
      { productCode: "NO_SUCH_PRODUCT", metadata: {} },
      { registry: new Map(), dedupeKey: "k" },
    );
    expect(ok).toBe("no-handler");
  });
});

// --------------------------------------------------------------------------
// order-fulfillment — normalized input (D-221-4)
// --------------------------------------------------------------------------

describe("order-fulfillment normalized handlers", () => {
  beforeEach(() => {
    resetFulfillmentRegistry();
    registerDefaultFulfillmentHandlers();
    resetProcessedSessions();
    vi.clearAllMocks();
  });

  it("legacy fulfillOrder adapts session → normalized mint input", async () => {
    const session = {
      id: "cs_legacy_passport",
      metadata: {
        productId: "passport-bronze",
        tier: "bronze",
        accountId: "0x2222222222222222222222222222222222222222",
        name: "Test Agent",
        capabilities: '["verification","discovery"]',
        endpoint: "https://agent.example",
        skills: '["scan"]',
        imageUrl: "https://img.example/a.png",
      },
      customer_details: { email: "test@example.com" },
      amount_total: 999,
    };
    const normalized = normalizeSession(session as never);
    expect(normalized.productCode).toBe("passport-bronze");
    expect(normalized.metadata).toMatchObject({ accountId: "0x2222222222222222222222222222222222222222" });

    await fulfillOrder(session as never);

    expect(mockedIssuePassport).toHaveBeenCalledTimes(1);
    const call = mockedIssuePassport.mock.calls[0];
    expect(call[0]).toBe("0x2222222222222222222222222222222222222222"); // accountId
    expect(call[2]).toBe("bronze"); // tier
    expect(call[3]).toBe("Test Agent"); // name
    expect(call[4]).toEqual(["verification", "discovery"]); // capabilities
    expect(call[5]).toBe("https://agent.example"); // endpoint
    expect(call[6]).toEqual(["scan"]); // skills
    expect(call[7]).toBe("https://img.example/a.png"); // imageUrl
  });

  it("fulfillPassportMint works directly on normalized input", async () => {
    await fulfillPassportMint({
      productCode: "PASSPORT_BRONZE",
      metadata: {
        accountId: "0x3333333333333333333333333333333333333333",
        tier: "bronze",
        name: "direct-agent",
        capabilities: ["scan"],
      },
    });
    expect(mockedIssuePassport).toHaveBeenCalledTimes(1);
    expect(mockedIssuePassport.mock.calls[0][0]).toBe("0x3333333333333333333333333333333333333333");
  });

  it("fulfillDirectoryListing accepts normalized input with listingId", async () => {
    await expect(
      fulfillDirectoryListing({
        productCode: "DIRECTORY_LISTING",
        metadata: { listingId: "lst_42" },
      }),
    ).resolves.toBe("executed");
  });

  it("legacy directory-listing session → directory handler path", async () => {
    const handler = vi.fn(async (_input: FulfillmentInput) => "executed" as const);
    const session = {
      id: "cs_legacy_dir",
      metadata: { productId: "directory-listing", listingId: "lst_1" },
      customer_email: "dir@example.com",
      amount_total: 2999,
    };
    await fulfillOrder(session as never, {
      registry: registryWith({ "directory-listing": handler }),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].metadata).toMatchObject({
      listingId: "lst_1",
    });
  });
});
