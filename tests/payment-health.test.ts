/**
 * SLICE-67-9: Test that /health endpoint reports Stripe configuration status.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

describe("GET /health — Stripe status", () => {
  let app: ReturnType<typeof makeTestApp>;
  let originalStripeKey: string | undefined;

  beforeAll(() => {
    setupMockEnv();
    originalStripeKey = process.env.STRIPE_SECRET_KEY;
    app = makeTestApp();
  });

  afterAll(() => {
    if (originalStripeKey) process.env.STRIPE_SECRET_KEY = originalStripeKey;
    else delete process.env.STRIPE_SECRET_KEY;
  });

  it("reports stripe as configured when STRIPE_SECRET_KEY is set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_testing";
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.payments).toBeDefined();
    expect(body.payments.stripe).toBe("configured");
  });

  it("reports stripe as not_configured when STRIPE_SECRET_KEY is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toBeDefined();
    expect(body.payments.stripe).toBe("not_configured");
  });
});
