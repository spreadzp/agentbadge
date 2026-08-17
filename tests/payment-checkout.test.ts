/**
 * SLICE-67-3: Unit tests for POST /api/payment/checkout endpoint.
 *
 * Mocks the Stripe client to avoid real API calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeTestApp, setupMockEnv } from "./e2e/helpers";

vi.mock("../src/server/lib/stripe-client", () => ({
  getStripeClient: vi.fn(),
  isStripeConfigured: vi.fn(),
}));

import { getStripeClient, isStripeConfigured } from "../src/server/lib/stripe-client";

const mockedGetStripeClient = vi.mocked(getStripeClient);
const mockedIsStripeConfigured = vi.mocked(isStripeConfigured);

function mockStripeClient(createResult: { url: string; id: string }) {
  mockedIsStripeConfigured.mockReturnValue(true);
  mockedGetStripeClient.mockReturnValue({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue(createResult),
      },
    },
  } as any);
}

describe("POST /api/payment/checkout", () => {
  beforeEach(() => {
    setupMockEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { url, sessionId } for valid productId", async () => {
    mockStripeClient({ url: "https://checkout.stripe.com/test123", id: "cs_test_123" });

    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("https://checkout.stripe.com/test123");
    expect(data.sessionId).toBe("cs_test_123");
  });

  it("returns 400 when productId is missing", async () => {
    mockStripeClient({ url: "x", id: "x" });

    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 for unknown productId", async () => {
    mockStripeClient({ url: "x", id: "x" });

    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "nonexistent-product" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 500 when Stripe is not configured", async () => {
    mockedIsStripeConfigured.mockReturnValue(false);

    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze" }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Stripe");
  });

  it("passes customer_email to Stripe when provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test", id: "cs_test" });
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: { sessions: { create: mockCreate } },
    } as any);

    const app = makeTestApp();
    await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze", email: "test@example.com" }),
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.customer_email).toBe("test@example.com");
  });

  it("merges metadata with product metadata in the session", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test", id: "cs_test" });
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: { sessions: { create: mockCreate } },
    } as any);

    const app = makeTestApp();
    await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: "passport-bronze",
        metadata: { accountId: "0.0.12345" },
      }),
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.metadata).toMatchObject({
      product: "passport",
      tier: "bronze",
      productId: "passport-bronze",
      accountId: "0.0.12345",
    });
  });

  it("success_url contains {CHECKOUT_SESSION_ID} template variable", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test", id: "cs_test" });
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: { sessions: { create: mockCreate } },
    } as any);

    const app = makeTestApp();
    await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze" }),
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.success_url).toContain("{CHECKOUT_SESSION_ID}");
  });

  it("cancel_url points to /payment/canceled", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test", id: "cs_test" });
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: { sessions: { create: mockCreate } },
    } as any);

    const app = makeTestApp();
    await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze" }),
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.cancel_url).toContain("/payment/canceled");
  });

  it("returns 500 when Stripe API throws", async () => {
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockRejectedValue(new Error("Stripe API error")),
        },
      },
    } as any);

    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze" }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Stripe");
  });

  it("returns 400 for invalid JSON body", async () => {
    mockStripeClient({ url: "x", id: "x" });

    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });
});
