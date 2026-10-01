/**
 * SLICE-152-1: venue offers catalog — store CRUD, API filters,
 * provider gate (ARC_VENUE_PROVIDER_GATE), admin delete, seed.
 * Chain layer injected (VenueDeps) — no live RPC.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  deactivateOffer,
  getOffer,
  getOfferById,
  listOffers,
  resetStoreForTesting,
  seedVenueOffers,
  upsertOffer,
  useMemoryStoreForTesting,
  type VenueOffer,
} from "../src/server/lib/venue/store";
import {
  createVenueApiRoutes,
  type VenueDeps,
} from "../src/server/routes/venue-api";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetConfigCache } from "../src/config/env";
import { createVenueStore } from "../src/server/lib/attestation-store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

const testNet: VenueNetwork = {
  name: "testnet",
  chain: {
    name: "arc-testnet",
    caip2: "eip155:5042002",
    chainId: 5042002,
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    rpcUrl: "https://rpc.test",
  },
  agenticCommerce: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  memo: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
  variant: "acp",
  abi: ERC8183_ACP_ABI,
  explorerTx: (h) => `https://testnet.arcscan.app/tx/${h}`,
  explorerAddr: (a) => `https://testnet.arcscan.app/address/${a}`,
};

const SAVED_DB_ENABLED = process.env.DATABASE_ENABLED;
const SAVED_GATE = process.env.ARC_VENUE_PROVIDER_GATE;
const SAVED_ADMIN = process.env.ARC_VENUE_ADMIN_KEY;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  delete process.env.ARC_VENUE_PROVIDER_GATE;
  delete process.env.ARC_VENUE_ADMIN_KEY;
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  resetVenueEventsForTests();
});
afterEach(() => {
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  if (SAVED_DB_ENABLED === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB_ENABLED;
  if (SAVED_GATE === undefined) delete process.env.ARC_VENUE_PROVIDER_GATE;
  else process.env.ARC_VENUE_PROVIDER_GATE = SAVED_GATE;
  if (SAVED_ADMIN === undefined) delete process.env.ARC_VENUE_ADMIN_KEY;
  else process.env.ARC_VENUE_ADMIN_KEY = SAVED_ADMIN;
  resetConfigCache();
});

const signedHeaders = {
  "x-wallet": WALLET,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
};

function offerFixture(over: Partial<VenueOffer> = {}): VenueOffer {
  return {
    id: "vo_test1",
    providerAddress: WALLET,
    agentId: 7,
    name: "bstock-delta",
    description: "market data feed",
    priceUsdc: 5,
    endpoint: "https://agentbadge.xyz/mcp/bstock",
    categories: ["market-data"],
    claimable: true,
    active: true,
    createdAt: "2026-09-30T12:00:00.000Z",
    ...over,
  };
}

function apiApp(
  agentOwner?: (id: number) => Promise<`0x${string}` | null>,
): Hono {
  const app = new Hono();
  const deps: VenueDeps = {
    network: () => testNet,
    onchainJob: async () => null,
    agentOwner: agentOwner ?? (async () => WALLET),
    attestations: createVenueStore(),
  };
  app.route("/", createVenueApiRoutes(deps));
  return app;
}

// ─── Store ───────────────────────────────────────────────────────

describe("VenueStore offers (152-1)", () => {
  it("upserts multiple offers per provider, keyed by id", () => {
    upsertOffer(offerFixture({ id: "vo_a", createdAt: "2026-01-01T00:00:00Z" }));
    upsertOffer(offerFixture({ id: "vo_b", name: "svc2", createdAt: "2026-02-01T00:00:00Z" }));
    expect(listOffers()).toHaveLength(2);
    expect(getOfferById("vo_b")?.name).toBe("svc2");
    // compat: provider lookup returns newest
    expect(getOffer(WALLET)?.id).toBe("vo_b");
  });

  it("generates id + defaults claimable/active when absent", () => {
    const legacy = offerFixture({ id: undefined as never });
    // simulate legacy record shape: no id
    delete (legacy as { id?: string }).id;
    upsertOffer(legacy);
    const all = listOffers();
    expect(all).toHaveLength(1);
    expect(all[0].id).toMatch(/^vo_/);
    expect(all[0].active).toBe(true);
    expect(all[0].claimable).toBe(true);
  });

  it("listOffers filters by provider and active", () => {
    upsertOffer(offerFixture({ id: "vo_a", providerAddress: WALLET }));
    upsertOffer(offerFixture({ id: "vo_b", providerAddress: OTHER, active: false }));
    expect(listOffers({ provider: WALLET })).toHaveLength(1);
    expect(listOffers({ provider: OTHER.toLowerCase() })).toHaveLength(1);
    expect(listOffers({ active: true })).toHaveLength(1);
    expect(listOffers({ active: false })).toHaveLength(1);
    expect(listOffers({ active: false })[0].id).toBe("vo_b");
  });

  it("deactivateOffer flips active, keeps record", () => {
    upsertOffer(offerFixture());
    expect(deactivateOffer("vo_test1")).toBe(true);
    expect(getOfferById("vo_test1")?.active).toBe(false);
    expect(deactivateOffer("vo_nope")).toBe(false);
  });

  it("seedVenueOffers inserts bstock dogfood offer idempotently", () => {
    seedVenueOffers();
    seedVenueOffers();
    const seeded = getOfferById("vo_bstock_dogfood");
    expect(seeded).toBeDefined();
    expect(seeded?.name).toContain("bstock");
    expect(seeded?.endpoint).toContain("https://");
    expect(listOffers()).toHaveLength(1);
  });
});

// ─── API ─────────────────────────────────────────────────────────

describe("venue offers api (152-1)", () => {
  const postOffer = (app: Hono, body: Record<string, unknown>) =>
    app.request("/api/venue/offers", {
      method: "POST",
      headers: signedHeaders,
      body: JSON.stringify(body),
    });

  it("GET /api/venue/offers filters provider + active", async () => {
    upsertOffer(offerFixture({ id: "vo_a" }));
    upsertOffer(offerFixture({ id: "vo_b", providerAddress: OTHER, active: false }));
    const app = apiApp();
    const all = await app.request("/api/venue/offers");
    expect((await all.json() as { offers: VenueOffer[] }).offers).toHaveLength(2);
    const prov = await app.request(`/api/venue/offers?provider=${OTHER}`);
    expect((await prov.json() as { offers: VenueOffer[] }).offers).toHaveLength(1);
    const act = await app.request("/api/venue/offers?active=true");
    expect((await act.json() as { offers: VenueOffer[] }).offers).toHaveLength(1);
  });

  it("POST without agentId is OK when provider gate is off", async () => {
    const res = await postOffer(apiApp(), {
      name: "no-passport svc",
      description: "d",
      endpoint: "https://x.dev",
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { offer: VenueOffer };
    expect(out.offer.id).toMatch(/^vo_/);
    expect(out.offer.claimable).toBe(true);
  });

  it("POST without agentId → 403 when ARC_VENUE_PROVIDER_GATE=1", async () => {
    process.env.ARC_VENUE_PROVIDER_GATE = "1";
    const res = await postOffer(apiApp(), {
      name: "svc", description: "d", endpoint: "https://x.dev",
    });
    expect(res.status).toBe(403);
  });

  it("POST with agentId still verifies ownerOf (gate off)", async () => {
    const res = await postOffer(apiApp(async () => OTHER), {
      agentId: 7, name: "svc", description: "d", endpoint: "https://x.dev",
    });
    expect(res.status).toBe(403);
  });

  it("POST validates priceUsdc and accepts title alias", async () => {
    const bad = await postOffer(apiApp(), {
      name: "svc", description: "d", priceUsdc: -5,
    });
    expect(bad.status).toBe(400);
    const good = await postOffer(apiApp(), {
      title: "titled svc", description: "d", priceUsdc: 2.5,
    });
    expect(good.status).toBe(200);
    const out = (await good.json()) as { offer: VenueOffer };
    expect(out.offer.name).toBe("titled svc");
    expect(out.offer.priceUsdc).toBe(2.5);
  });

  it("DELETE /api/venue/offers/:id → 403 without admin key, deactivates with it", async () => {
    upsertOffer(offerFixture());
    const app = apiApp();
    const noKey = await app.request("/api/venue/offers/vo_test1", { method: "DELETE" });
    expect(noKey.status).toBe(403);
    const wrongKey = await app.request("/api/venue/offers/vo_test1", {
      method: "DELETE", headers: { authorization: "Bearer nope" },
    });
    expect(wrongKey.status).toBe(403);
    process.env.ARC_VENUE_ADMIN_KEY = "sekrit";
    const ok = await app.request("/api/venue/offers/vo_test1", {
      method: "DELETE", headers: { authorization: "Bearer sekrit" },
    });
    expect(ok.status).toBe(200);
    expect(getOfferById("vo_test1")?.active).toBe(false);
  });

  it("offers sorted newest-first", async () => {
    upsertOffer(offerFixture({ id: "vo_old", createdAt: "2026-01-01T00:00:00Z" }));
    upsertOffer(offerFixture({ id: "vo_new", createdAt: "2026-09-01T00:00:00Z" }));
    const res = await apiApp().request("/api/venue/offers");
    const offers = (await res.json() as { offers: VenueOffer[] }).offers;
    expect(offers[0].id).toBe("vo_new");
  });
});
