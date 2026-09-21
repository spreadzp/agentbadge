// SLICE-140-2 (D9): contract tests for wiring/payments.ts on isolated Hono apps.
// Verifies env-gating: with no payment env configured, wirePaymentGates registers
// nothing and requests pass through; wireL402 always registers its middleware.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { wireL402, wirePaymentGates } from "../../../src/server/wiring/payments";

const PAYMENT_ENV_KEYS = [
  "x402_FACILITATOR_URL",
  "x402_TREASURY",
  "HEDERA_OPERATOR_ID",
  "x402_FEE_PAYER",
  "MPP_SECRET_KEY",
  "MPP_RECIPIENT_ADDRESS",
  "MPP_AMOUNT",
  "STRIPE_SECRET_KEY",
  "CHAIN_MODE",
  "X402_FACILITATOR_URL",
  "BASE_USDC_ADDRESS",
  "BASE_TREASURY",
  "X402_BASE_PRICE",
  "L402_AMOUNT_SATS",
  "L402_ROOT_KEY",
  "L402_LND_URL",
  "L402_LND_MACAROON",
  "L402_TEST_MODE",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of PAYMENT_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PAYMENT_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// Hono matches middleware in registration order — wire BEFORE adding the route
// handler, mirroring index.ts where gates are registered before route mounts.
function appWithPassportRoute(wire: (app: Hono) => void): Hono {
  const app = new Hono();
  wire(app);
  app.post("/passport/request", (c) => c.json({ ok: true }));
  return app;
}

describe("wirePaymentGates", () => {
  it("registers no middleware when env is empty (gates off)", async () => {
    const app = appWithPassportRoute(wirePaymentGates);

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // No payment gate → request reaches the handler
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("registers no middleware when only CHAIN_MODE=hedera (default)", async () => {
    process.env.CHAIN_MODE = "hedera";
    const app = appWithPassportRoute(wirePaymentGates);

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
});

describe("wireL402", () => {
  it("passes through when L402 is disabled (no LND env, no test mode)", async () => {
    const app = appWithPassportRoute(wireL402);

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("returns 402 with L402 challenge when L402_TEST_MODE=true", async () => {
    process.env.L402_TEST_MODE = "true";
    const app = appWithPassportRoute(wireL402);

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("WWW-Authenticate")).toContain("L402");
  });
});
