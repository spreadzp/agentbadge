/**
 * SLICE-83-4: L402 middleware mode logic tests.
 *
 * Verifies the three-mode matrix:
 * 1. Unset vars → disabled (no gate, startup warning) — NOT accept-any
 * 2. L402_TEST_MODE=true → accepts any preimage (dev mode)
 * 3. Real LND vars → challenge flow (mocked)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { l402PaymentMiddleware, resolveL402Mode } from "../../src/server/middleware/l402";

function makeApp(config: Parameters<typeof l402PaymentMiddleware>[0]): Hono {
  const app = new Hono();
  app.use("/paid", l402PaymentMiddleware(config));
  app.post("/paid", (c) => c.json({ ok: true }));
  return app;
}

describe("SLICE-83-4: L402 mode resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.L402_TEST_MODE;
    delete process.env.L402_LND_URL;
    delete process.env.L402_LND_MACAROON;
    delete process.env.L402_ROOT_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveL402Mode", () => {
    it("returns 'disabled' when no LND vars and no TEST_MODE flag", () => {
      const mode = resolveL402Mode({ amountSats: 100 });
      expect(mode).toBe("disabled");
    });

    it("returns 'test' when L402_TEST_MODE=true explicitly", () => {
      process.env.L402_TEST_MODE = "true";
      const mode = resolveL402Mode({ amountSats: 100 });
      expect(mode).toBe("test");
    });

    it("returns 'production' when LND URL + macaroon are set", () => {
      process.env.L402_LND_URL = "https://lnd.example.com:10009";
      process.env.L402_LND_MACAROON = "abc123";
      const mode = resolveL402Mode({ amountSats: 100 });
      expect(mode).toBe("production");
    });

    it("returns 'disabled' when L402_TEST_MODE is not 'true' (e.g. 'false')", () => {
      process.env.L402_TEST_MODE = "false";
      const mode = resolveL402Mode({ amountSats: 100 });
      expect(mode).toBe("disabled");
    });

    it("returns 'test' when config.testMode=true is passed explicitly", () => {
      const mode = resolveL402Mode({ amountSats: 100, testMode: true });
      expect(mode).toBe("test");
    });

    it("returns 'production' when config.lndUrl is set even without env vars", () => {
      const mode = resolveL402Mode({
        amountSats: 100,
        lndUrl: "https://lnd.example.com:10009",
        lndMacaroon: "abc123",
      });
      expect(mode).toBe("production");
    });
  });

  describe("middleware behavior — disabled mode", () => {
    it("passes through without 402 when disabled (no vars set)", async () => {
      const app = makeApp({ amountSats: 100 });
      const res = await app.request("/paid", { method: "POST" });
      expect(res.status).not.toBe(402);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  describe("middleware behavior — test mode", () => {
    it("returns 402 challenge when no auth header in test mode", async () => {
      process.env.L402_TEST_MODE = "true";
      const app = makeApp({ amountSats: 100 });
      const res = await app.request("/paid", { method: "POST" });
      expect(res.status).toBe(402);
      const wwwAuth = res.headers.get("www-authenticate");
      expect(wwwAuth).toContain("L402");
    });

    it("accepts any preimage in test mode with L402 auth header", async () => {
      process.env.L402_TEST_MODE = "true";
      const app = makeApp({ amountSats: 100 });
      // First get a challenge
      const challengeRes = await app.request("/paid", { method: "POST" });
      expect(challengeRes.status).toBe(402);
      const wwwAuth = challengeRes.headers.get("www-authenticate") ?? "";
      const macaroonMatch = wwwAuth.match(/macaroon="([^"]+)"/);
      const macaroon = macaroonMatch ? macaroonMatch[1] : "test";

      // Retry with any preimage
      const res = await app.request("/paid", {
        method: "POST",
        headers: { Authorization: `L402 ${macaroon}:anyPreimage` },
      });
      expect(res.status).not.toBe(402);
    });
  });
});
