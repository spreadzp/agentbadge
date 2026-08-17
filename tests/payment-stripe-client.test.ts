/**
 * SLICE-67-1: Unit tests for Stripe client configuration.
 *
 * Tests:
 * - getStripeClient() returns a singleton Stripe instance
 * - getStripeClient() throws when STRIPE_SECRET_KEY is missing
 * - isStripeConfigured() returns true/false based on env var
 * - getStripeClient() returns the same instance on subsequent calls
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";

import { getStripeClient, isStripeConfigured } from "../src/server/lib/stripe-client";

describe("isStripeConfigured", () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.STRIPE_SECRET_KEY = originalKey;
    } else {
      delete process.env.STRIPE_SECRET_KEY;
    }
  });

  it("returns true when STRIPE_SECRET_KEY is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(isStripeConfigured()).toBe(true);
  });

  it("returns false when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(isStripeConfigured()).toBe(false);
  });

  it("returns false when STRIPE_SECRET_KEY is empty string", () => {
    process.env.STRIPE_SECRET_KEY = "";
    expect(isStripeConfigured()).toBe(false);
  });
});

describe("getStripeClient", () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.STRIPE_SECRET_KEY = originalKey;
    } else {
      delete process.env.STRIPE_SECRET_KEY;
    }
  });

  it("throws when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripeClient()).toThrow("STRIPE_SECRET_KEY");
  });

  it("returns a Stripe instance when STRIPE_SECRET_KEY is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    const client = getStripeClient();
    expect(client).toBeDefined();
    expect(typeof client.checkout.sessions.create).toBe("function");
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_singleton_test";
    const client1 = getStripeClient();
    const client2 = getStripeClient();
    expect(client1).toBe(client2);
  });
});
