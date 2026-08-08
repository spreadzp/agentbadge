/**
 * SLICE-49-19: L402 Lightning payment support
 *
 * Verifies that paid endpoints return 402 with L402 challenge
 * (WWW-Authenticate: L402 macaroon=... invoice=...) and accept
 * Authorization: L402 macaroon:preimage header for paid requests.
 *
 * L402 protocol: https://docs.lightning.engineering/the-lightning-network/l402/l402
 */

import { describe, it, expect } from "vitest";

const BASE_URL = process.env.E2E_TARGET_URL ?? "http://localhost:4021";

describe("L402 Lightning payment", () => {
  it("paid endpoint returns 402 with L402 challenge", async () => {
    const resp = await fetch(`${BASE_URL}/passport/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });

    expect(resp.status).toBe(402);

    const wwwAuth = resp.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain("L402");
    expect(wwwAuth).toContain("macaroon=");
    expect(wwwAuth).toContain("invoice=");
  }, 15000);

  it("402 response includes macaroon and invoice in WWW-Authenticate", async () => {
    const resp = await fetch(`${BASE_URL}/passport/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });

    expect(resp.status).toBe(402);

    const wwwAuth = resp.headers.get("www-authenticate") ?? "";

    // L402 format: L402 macaroon="<base64>", invoice="<bolt11>"
    const macaroonMatch = wwwAuth.match(/macaroon="([^"]+)"/);
    const invoiceMatch = wwwAuth.match(/invoice="([^"]+)"/);

    expect(macaroonMatch).not.toBeNull();
    expect(invoiceMatch).not.toBeNull();
    expect(macaroonMatch![1].length).toBeGreaterThan(0);
    expect(invoiceMatch![1].length).toBeGreaterThan(0);
    // Lightning invoice starts with "lnbc" (mainnet) or "lntb" (testnet) or "lnbcrt" (regtest)
    expect(invoiceMatch![1]).toMatch(/^ln(bc|tb|bcrt)/);
  }, 15000);

  it("accepts L402 authorization header and does not return 402", async () => {
    // First, get a challenge to obtain a valid macaroon
    const challengeResp = await fetch(`${BASE_URL}/passport/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });

    expect(challengeResp.status).toBe(402);

    const wwwAuth = challengeResp.headers.get("www-authenticate") ?? "";
    const macaroonMatch = wwwAuth.match(/macaroon="([^"]+)"/);
    const macaroon = macaroonMatch ? macaroonMatch[1] : "testMacaroon";

    // Now retry with L402 auth header — should not return 402
    // In test mode, any preimage that matches the expected format is accepted
    const resp = await fetch(`${BASE_URL}/passport/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `L402 ${macaroon}:testPreimage`,
      },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });

    // Should not return 402 when L402 auth provided
    expect(resp.status).not.toBe(402);
  }, 15000);
});
