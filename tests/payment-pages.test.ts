/**
 * SLICE-67-5: Unit tests for GET /payment/success and GET /payment/canceled pages.
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

describe("GET /payment/success", () => {
  beforeEach(() => {
    setupMockEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns HTML with confirmation message when session_id is provided", async () => {
    mockedIsStripeConfigured.mockReturnValue(false);

    const app = makeTestApp();
    const res = await app.request("/payment/success?session_id=cs_test_123", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Payment");
    expect(text).toContain("cs_test_123");
  });

  it("returns HTML error when session_id is missing", async () => {
    mockedIsStripeConfigured.mockReturnValue(false);

    const app = makeTestApp();
    const res = await app.request("/payment/success", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("session");
  });

  it("retrieves session details from Stripe when configured", async () => {
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "cs_test_456",
            status: "complete",
            customer_email: "test@example.com",
            amount_total: 999,
            metadata: { productId: "passport-bronze" },
          }),
        },
      },
    } as any);

    const app = makeTestApp();
    const res = await app.request("/payment/success?session_id=cs_test_456", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("test@example.com");
  });

  it("shows graceful fallback when Stripe retrieval fails", async () => {
    mockedIsStripeConfigured.mockReturnValue(true);
    mockedGetStripeClient.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockRejectedValue(new Error("Stripe API error")),
        },
      },
    } as any);

    const app = makeTestApp();
    const res = await app.request("/payment/success?session_id=cs_test_789", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("cs_test_789");
  });
});

describe("GET /payment/canceled", () => {
  beforeEach(() => {
    setupMockEnv();
    vi.clearAllMocks();
  });

  it("returns HTML with cancel message", async () => {
    const app = makeTestApp();
    const res = await app.request("/payment/canceled", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Canceled");
  });

  it("includes a retry link", async () => {
    const app = makeTestApp();
    const res = await app.request("/payment/canceled", {
      method: "GET",
    });

    const text = await res.text();
    expect(text).toContain("href");
  });
});
