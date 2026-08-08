import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";

describe("Bazaar discovery", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("x402.json has bazaar discoverable extension", async () => {
    const res = await app.request("/.well-known/x402.json");
    const body = await res.json();
    expect(body.extensions).toBeTruthy();
    expect(body.extensions.bazaar).toBeTruthy();
    expect(body.extensions.bazaar.discoverable).toBe(true);
  });

  it("has at least one discoverable service", async () => {
    const body = await (await app.request("/.well-known/x402.json")).json();
    const discoverable = body.services.filter(
      (s: any) => s.extensions?.bazaar?.discoverable === true,
    );
    expect(discoverable.length).toBeGreaterThan(0);
  });

  it("provider name specified", async () => {
    const body = await (await app.request("/.well-known/x402.json")).json();
    expect(body.name).toBeTruthy();
  });

  it("facilitator specified", async () => {
    const body = await (await app.request("/.well-known/x402.json")).json();
    expect(body.facilitator).toBeTruthy();
  });

  it("payTo specified", async () => {
    const body = await (await app.request("/.well-known/x402.json")).json();
    // Accept Hedera account IDs (0.0.xxxx) or EVM addresses (0x...)
    expect(body.payTo).toBeTruthy();
    expect(
      /^0x[a-fA-F0-9]{40}$/.test(body.payTo) ||
        /^\d+\.\d+\.\d+$/.test(body.payTo),
    ).toBe(true);
  });
});
