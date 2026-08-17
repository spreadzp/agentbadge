/**
 * SLICE-67-8: E2E test for Stripe checkout flow.
 *
 * This test verifies the full flow:
 * 1. Create a checkout session via POST /api/payment/checkout
 * 2. Simulate a webhook event using Stripe SDK's generateTestHeaderString
 * 3. Verify the webhook handler processes the event
 * 4. Verify idempotency — duplicate events don't trigger duplicate fulfillment
 *
 * No real Stripe API keys or Stripe CLI required — all mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";
import { makeTestApp, setupMockEnv } from "./helpers";

// Mock issuePassport so we don't hit Hedera, but preserve all other exports
vi.mock("@agentgate-hedera/passport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentgate-hedera/passport")>();
  return {
    ...actual,
    issuePassport: vi.fn().mockResolvedValue({
      tokenId: "0.0.999",
      serialNumber: 1,
      did: "did:hcs:0.0.999:1",
      tier: "bronze",
      hashScanLink: "https://hashscan.io/testnet/token/0.0.999/1",
    }),
  };
});

// Mock Stripe client to avoid real API calls
vi.mock("../../src/server/lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/lib/stripe-client")>();
  const mockStripe = new Stripe("sk_test_fake_key_for_testing", {
    apiVersion: "2025-06-30.basil" as Stripe.LatestApiVersion,
  });
  // Override checkout.sessions.create to return a fake session
  mockStripe.checkout.sessions = {
    ...mockStripe.checkout.sessions,
    create: vi.fn().mockResolvedValue({
      id: "cs_test_e2e_001",
      url: "https://checkout.stripe.com/c/pay/cs_test_e2e_001",
      object: "checkout.session",
    }),
  } as any;
  return {
    ...actual,
    getStripeClient: () => mockStripe,
    isStripeConfigured: () => true,
  };
});

import { issuePassport } from "@agentgate-hedera/passport";
import { resetProcessedSessions } from "../../src/server/lib/order-fulfillment";

const mockedIssuePassport = vi.mocked(issuePassport);

const stripe = new Stripe("sk_test_fake_key_for_testing", {
  apiVersion: "2025-06-30.basil" as Stripe.LatestApiVersion,
});

const WEBHOOK_SECRET = "whsec_test_secret_for_e2e";

describe("Stripe checkout E2E flow", () => {
  let app: ReturnType<typeof makeTestApp>;
  let originalStripeKey: string | undefined;
  let originalWebhookSecret: string | undefined;

  beforeAll(() => {
    setupMockEnv();
    originalStripeKey = process.env.STRIPE_SECRET_KEY;
    originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_testing";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.PUBLIC_BASE_URL = "http://localhost:4021";
    app = makeTestApp();
  });

  afterAll(() => {
    if (originalStripeKey) process.env.STRIPE_SECRET_KEY = originalStripeKey;
    else delete process.env.STRIPE_SECRET_KEY;
    if (originalWebhookSecret) process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
    else delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetProcessedSessions();
  });

  it("creates a checkout session and processes the webhook event", async () => {
    // Step 1: Create checkout session
    const checkoutRes = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: "passport-bronze",
        email: "test@example.com",
        metadata: {
          accountId: "0.0.12345",
          name: "E2E Test Agent",
          capabilities: '["verification"]',
        },
      }),
    });

    expect(checkoutRes.status).toBe(200);
    const checkoutBody = await checkoutRes.json();
    expect(checkoutBody.url).toContain("checkout.stripe.com");
    expect(checkoutBody.sessionId).toBeTruthy();

    // Step 2: Simulate webhook event
    const sessionObject = {
      id: checkoutBody.sessionId,
      object: "checkout.session",
      status: "complete",
      metadata: {
        productId: "passport-bronze",
        tier: "bronze",
        accountId: "0.0.12345",
        name: "E2E Test Agent",
        capabilities: '["verification"]',
      },
      customer_email: "test@example.com",
    };

    const payload = JSON.stringify({
      id: "evt_test_e2e_001",
      object: "event",
      type: "checkout.session.completed",
      data: { object: sessionObject },
    });

    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    const webhookRes = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });

    expect(webhookRes.status).toBe(200);
    const webhookBody = await webhookRes.json();
    expect(webhookBody.received).toBe(true);

    // Step 3: Verify fulfillment was triggered
    expect(mockedIssuePassport).toHaveBeenCalledTimes(1);
    const call = mockedIssuePassport.mock.calls[0];
    expect(call[0]).toBe("0.0.12345"); // accountId
    expect(call[2]).toBe("bronze"); // tier
  });

  it("rejects webhook with invalid signature", async () => {
    const payload = JSON.stringify({
      id: "evt_test_bad_sig",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_bad" } },
    });

    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "wrong_secret",
    });

    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });

    expect(res.status).toBe(400);
  });

  it("does not fulfill duplicate webhook events (idempotency)", async () => {
    const sessionObject = {
      id: "cs_test_idempotency_001",
      object: "checkout.session",
      status: "complete",
      metadata: {
        productId: "passport-bronze",
        tier: "bronze",
        accountId: "0.0.99999",
        name: "Idempotency Test Agent",
        capabilities: "[]",
      },
    };

    const payload = JSON.stringify({
      id: "evt_test_idempotency_001",
      object: "event",
      type: "checkout.session.completed",
      data: { object: sessionObject },
    });

    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    // Send the same webhook event twice
    const res1 = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });

    const res2 = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // issuePassport should only be called once despite duplicate webhook
    expect(mockedIssuePassport).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for checkout with unknown product", async () => {
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "nonexistent-product" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for checkout without productId", async () => {
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("handles unknown webhook event types gracefully", async () => {
    const payload = JSON.stringify({
      id: "evt_test_unknown_type",
      object: "event",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_test_123" } },
    });

    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockedIssuePassport).not.toHaveBeenCalled();
  });
});
