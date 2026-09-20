import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { marketplacePageRoutes } from "../src/server/routes/marketplace-pages";
import {
  upsertService,
  useMemoryStoreForTesting,
  resetStoreForTesting,
  serviceIdFor,
  subIdToBytes32,
} from "../src/server/lib/marketplace";

/**
 * SLICE-138-5: marketplace UI tests — SSR pages render catalog data,
 * 404s, checkout + onboarding shells.
 */

const SVC_ID = serviceIdFor(1n, subIdToBytes32("api"));

const SVC = {
  serviceId: SVC_ID,
  passportId: "1",
  owner: "0x00000000000000000000000000000000000000aa",
  subId: "api",
  name: "Acme Search API",
  description: "Fast search endpoint",
  category: "data",
  docsUrl: "https://docs.acme.example",
  endpointUrl: "https://api.acme.example",
  priceUsd: "5.00",
  priceBaseUnits: "5000000",
  durationDays: 30,
  metaURI: "local://x",
  createdAt: "2026-09-19T00:00:00.000Z",
};

function makeApp() {
  const app = new Hono();
  app.route("/", marketplacePageRoutes);
  return app;
}

describe("SLICE-138-5: marketplace UI", () => {
  beforeEach(() => useMemoryStoreForTesting());
  afterEach(() => resetStoreForTesting());

  it("GET /market/services renders empty state", async () => {
    const res = await makeApp().request("/market/services");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Service Marketplace");
    expect(html).toContain("No services yet");
    expect(html).toContain("/market/sell");
  });

  it("GET /market/services renders service cards + filters", async () => {
    upsertService(SVC);
    const app = makeApp();
    const res = await app.request("/market/services");
    const html = await res.text();
    expect(html).toContain("Acme Search API");
    expect(html).toContain("$5.00 USDC");
    expect(html).toContain("30d pass");
    expect(html).toContain(`/market/services/${SVC_ID}`);
    // JSON-LD ItemList
    expect(html).toContain('"@type":"ItemList"');
    // filters
    const filtered = await app.request("/market/services?q=zzz");
    expect(await filtered.text()).toContain("No services yet");
    const byCat = await app.request("/market/services?category=data");
    expect(await byCat.text()).toContain("Acme Search API");
  });

  it("GET /market/services/:id renders detail + buy link, 404 unknown", async () => {
    upsertService(SVC);
    const app = makeApp();
    const res = await app.request(`/market/services/${SVC_ID}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Acme Search API");
    expect(html).toContain(`/market/buy/${SVC_ID}`);
    expect(html).toContain('"@type":"Service"');
    expect(html).toContain("docs.acme.example");
    const missing = await app.request(
      `/market/services/${"0x".concat("ab".repeat(32))}`,
    );
    expect(missing.status).toBe(404);
  });

  it("GET /market/buy/:serviceId renders checkout, 404 unknown", async () => {
    upsertService(SVC);
    const app = makeApp();
    const res = await app.request(`/market/buy/${SVC_ID}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Connect wallet");
    expect(html).toContain("x402Fetch");
    expect(html).toContain(`/api/market/buy/${SVC_ID}`);
    expect(html).toContain("PAYMENT-SIGNATURE");
    const missing = await app.request(
      `/market/buy/${"0x".concat("cd".repeat(32))}`,
    );
    expect(missing.status).toBe(404);
  });

  it("GET /market/sell renders onboarding forms", async () => {
    const res = await makeApp().request("/market/sell");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Business Passport");
    expect(html).toContain("passport-form");
    expect(html).toContain("service-form");
    expect(html).toContain("/api/market/passport");
    expect(html).toContain("/api/market/services");
  });

  it("GET /market/passes renders wallet lookup", async () => {
    const res = await makeApp().request("/market/passes");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("My Passes");
    expect(html).toContain("/api/market/passes/");
  });
});
