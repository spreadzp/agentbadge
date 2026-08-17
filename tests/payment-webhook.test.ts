/**
 * SLICE-67-4: Unit tests for POST /api/stripe/webhook endpoint.
 *
 * Mocks the Stripe client to test signature verification and event handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeTestApp, setupMockEnv } from "./e2e/helpers";

vi.mock("../src/server/lib/stripe-client", () => ({
  getStripeClient: vi.fn(),
  isStripeConfigured: vi.fn(),
}));

vi.mock("../src/server/lib/order-fulfillment", () => ({
  fulfillOrder: vi.fn().mockResolvedValue(undefined),
}));

import { getStripeClient, isStripeConfigured } from "../src/server/lib/stripe-client";
import { fulfillOrder } from "../src/server/lib/order-fulfillment";

const mockedGetStripeClient = vi.mocked(getStripeClient);
const mockedIsStripeConfigured = vi.mocked(isStripeConfigured);
const mockedFulfillOrder = vi.mocked(fulfillOrder);

function mockStripeWebhook(constructEventResult: any) {
  mockedIsStripeConfigured.mockReturnValue(true);
  mockedGetStripeClient.mockReturnValue({
    webhooks: {
      constructEvent: vi.fn().mockReturnValue(constructEventResult),
    },
  } as any);
}

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    setupMockEnv();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { received: true } for valid checkout.session.completed event", async () => {
    const mockEvent = {
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", metadata: { productId: "passport-bronze" } } },
    };
    mockStripeWebhook(mockEvent);

    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
    expect(mockedFulfillOrder).toHaveBeenCalledOnce();
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    mockStripeWebhook({});

    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("stripe-signature");
  });

  it("returns 400 when signature verification fails", async () => {
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockImplementation(() => {
          throw new Error("Invalid signature");
        }),
      },
    } as any);

    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=bad",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Webhook signature verification failed");
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not set", async () => {
    mockStripeWebhook({});
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("returns 500 when Stripe is not configured", async () => {
    mockedIsStripeConfigured.mockReturnValue(false);

    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Stripe");
  });

  it("acknowledges unhandled event types with { received: true }", async () => {
    const mockEvent = {
      type: "payment_intent.payment_failed",
      data: { object: {} },
    };
    mockStripeWebhook(mockEvent);

    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
      body: JSON.stringify({ type: "payment_intent.payment_failed" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
    expect(mockedFulfillOrder).not.toHaveBeenCalled();
  });

  it("passes the session object to fulfillOrder for checkout.session.completed", async () => {
    const sessionObj = { id: "cs_test_456", metadata: { productId: "passport-gold" } };
    const mockEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObj },
    };
    mockStripeWebhook(mockEvent);

    const app = makeTestApp();
    await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });

    expect(mockedFulfillOrder).toHaveBeenCalledOnce();
    const passedSession = mockedFulfillOrder.mock.calls[0][0];
    expect(passedSession.id).toBe("cs_test_456");
    expect(passedSession.metadata.productId).toBe("passport-gold");
  });
});
