import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  buildAccessChallenge,
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
  type AgentAuthVariables,
} from "../src/server/middleware/agent-auth";
import { marketplaceApiRoutes } from "../src/server/routes/marketplace-api";
import {
  configureMarketplaceForTesting,
  resetMarketplaceForTesting,
  useMemoryStoreForTesting,
  createMarketplaceMintOnSettleHook,
  serviceIdFor,
  subIdToBytes32,
  usdToBaseUnits,
  validatePassportMeta,
  validateServiceMeta,
  listServices,
  type MarketplaceOps,
} from "../src/server/lib/marketplace";
import { resetConfigCache } from "../src/config/env";

/**
 * SLICE-138-3: marketplace backend tests.
 *
 * Real EOA signatures (viem ecrecover, no RPC); chain ops stubbed via
 * configureMarketplaceForTesting; catalog store in-memory. x402 gating
 * itself is wired in index.ts and covered by the hook tests below.
 */

const BIZ_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const OTHER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const biz = privateKeyToAccount(BIZ_KEY);
const other = privateKeyToAccount(OTHER_KEY);
const BUYER = "0x00000000000000000000000000000000000000bb";

const PASSPORT_ID = 1n;
const SUB_ID = "api";
const SVC_ID = serviceIdFor(PASSPORT_ID, subIdToBytes32(SUB_ID));

const VALID_PASSPORT_META = {
  name: "Acme AI",
  endpointUrl: "https://api.acme.example",
  category: "data",
  description: "Acme data API",
  docsUrl: "https://docs.acme.example",
};

const VALID_SERVICE_META = {
  passportTokenId: "1",
  subId: SUB_ID,
  name: "Acme Search API",
  priceUsd: "5.00",
  durationDays: 30,
  description: "Search endpoint",
  category: "data",
};

function makeApp() {
  const app = new Hono<{ Variables: AgentAuthVariables }>();
  app.route("/api", marketplaceApiRoutes);
  return app;
}

async function sigHeaders(
  account: typeof biz,
  method: string,
  path: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildAccessChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
  });
  const signature = await account.signMessage({ message });
  return {
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
    "content-type": "application/json",
  };
}

function fakeOps(overrides: Partial<MarketplaceOps> = {}): MarketplaceOps {
  return {
    mintPassport: vi.fn(async () => "0xmintpassport"),
    registerService: vi.fn(async () => "0xregsvc"),
    mintServicePass: vi.fn(async () => "0xmintsvc"),
    creditPayment: vi.fn(async () => "0xcredit"),
    passportOf: vi.fn(async () => PASSPORT_ID),
    passportValid: vi.fn(async () => true),
    passportOwner: vi.fn(async () => biz.address.toLowerCase()),
    getService: vi.fn(async () => ({
      passportId: PASSPORT_ID,
      price: 5_000_000n,
      metaURI: "local://x",
      active: true,
    })),
    servicePassOf: vi.fn(async () => 0n),
    passExpiresAt: vi.fn(async () => 0n),
    ...overrides,
  };
}

describe("SLICE-138-3: marketplace backend", () => {
  let ops: MarketplaceOps;

  beforeEach(() => {
    process.env.MOCK_HEDERA = "true";
    // loadConfig() requires hedera fields in default chainMode — dummy values.
    process.env.HEDERA_OPERATOR_ID = "0.0.1";
    process.env.HEDERA_OPERATOR_KEY = "dummy";
    process.env.PASSPORT_TOKEN_ID = "0.0.1";
    process.env.AUDIT_TOPIC_ID = "0.0.1";
    process.env.DIRECTORY_TOPIC_ID = "0.0.1";
    process.env.x402_FACILITATOR_URL = "https://x402.test";
    process.env.x402_FEE_PAYER = "0.0.1";
    process.env.x402_TREASURY = "0.0.1";
    process.env.IPFS_API_KEY = "dummy";
    process.env.IPFS_API_SECRET = "dummy";
    process.env.MOCK_IPFS = "true"; // force local pin fallback
    process.env.MARKETPLACE_ENABLED = "true";
    process.env.MARKETPLACE_NFT =
      "0xb42f7c30e4dc14877dac7948bfcb2db455df2962";
    process.env.MARKETPLACE_SPLITTER =
      "0xbfc6b4c980e979dccaaebb4caf875e1b8e9b2b42";
    process.env.MARKETPLACE_TREASURY =
      "0xcdd23d104aa4c10de65f4dd0571edfec0458699d";
    resetConfigCache();
    useMemoryStoreForTesting();
    ops = fakeOps();
    configureMarketplaceForTesting({ ops });
    configureAgentAuthForTesting({
      verifier: async (wallet, message, signature) =>
        verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        }),
    });
  });

  afterEach(() => {
    resetMarketplaceForTesting();
    resetAgentAuthForTesting();
    resetConfigCache();
  });

  // ─── Validation ──────────────────────────────────────────────
  describe("validatePassportMeta (D10)", () => {
    it("accepts valid metadata", () => {
      const v = validatePassportMeta(VALID_PASSPORT_META);
      expect(v.ok).toBe(true);
    });

    it("rejects non-https endpointUrl / docsUrl", () => {
      expect(
        validatePassportMeta({
          ...VALID_PASSPORT_META,
          endpointUrl: "http://insecure.example",
        }).ok,
      ).toBe(false);
      expect(
        validatePassportMeta({
          ...VALID_PASSPORT_META,
          docsUrl: "ftp://docs.example",
        }).ok,
      ).toBe(false);
    });

    it("rejects missing fields and oversized description", () => {
      expect(validatePassportMeta({}).ok).toBe(false);
      expect(
        validatePassportMeta({
          ...VALID_PASSPORT_META,
          description: "x".repeat(501),
        }).ok,
      ).toBe(false);
    });

    it("rejects JSON > 4KB", () => {
      expect(
        validatePassportMeta({
          ...VALID_PASSPORT_META,
          name: "n",
          description: "d".repeat(400),
          extra: "e".repeat(4000),
        }).ok,
      ).toBe(false);
    });
  });

  describe("validateServiceMeta", () => {
    it("accepts valid input", () => {
      expect(validateServiceMeta(VALID_SERVICE_META).ok).toBe(true);
    });

    it("rejects bad subId, sub-$1 price, bad duration", () => {
      expect(
        validateServiceMeta({ ...VALID_SERVICE_META, subId: "Bad_ID!" }).ok,
      ).toBe(false);
      expect(
        validateServiceMeta({ ...VALID_SERVICE_META, priceUsd: "0.50" }).ok,
      ).toBe(false);
      expect(
        validateServiceMeta({ ...VALID_SERVICE_META, durationDays: 0 }).ok,
      ).toBe(false);
      expect(
        validateServiceMeta({ ...VALID_SERVICE_META, durationDays: 400 }).ok,
      ).toBe(false);
    });

    it("accepts durationSec instead of durationDays (SLICE-139-3)", () => {
      const { durationDays: _d, ...noDays } = VALID_SERVICE_META;
      const v = validateServiceMeta({ ...noDays, durationSec: 180 });
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.value.durationSec).toBe(180);
        expect(v.value.durationDays).toBe(1); // derived: ceil(180/86400)
      }
    });

    it("durationSec wins when both are given", () => {
      const v = validateServiceMeta({
        ...VALID_SERVICE_META,
        durationDays: 30,
        durationSec: 300,
      });
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.value.durationSec).toBe(300);
        expect(v.value.durationDays).toBe(30);
      }
    });

    it("rejects bad durationSec and missing duration", () => {
      const { durationDays: _d, ...noDays } = VALID_SERVICE_META;
      expect(validateServiceMeta({ ...noDays, durationSec: 30 }).ok).toBe(false); // <60
      expect(
        validateServiceMeta({ ...noDays, durationSec: 31_536_001 }).ok,
      ).toBe(false); // >1y
      expect(validateServiceMeta({ ...noDays, durationSec: 1.5 }).ok).toBe(false);
      expect(validateServiceMeta(noDays).ok).toBe(false); // neither given
    });
  });

  describe("helpers", () => {
    it("usdToBaseUnits converts decimal strings", () => {
      expect(usdToBaseUnits("5")).toBe(5_000_000n);
      expect(usdToBaseUnits("5.50")).toBe(5_500_000n);
      expect(usdToBaseUnits("0.000001")).toBe(1n);
      expect(() => usdToBaseUnits("abc")).toThrow();
    });

    it("serviceIdFor is deterministic keccak256(passportId, subId)", () => {
      expect(SVC_ID).toMatch(/^0x[0-9a-f]{64}$/);
      expect(serviceIdFor(PASSPORT_ID, subIdToBytes32(SUB_ID))).toBe(SVC_ID);
      expect(serviceIdFor(2n, subIdToBytes32(SUB_ID))).not.toBe(SVC_ID);
    });
  });

  // ─── POST /api/market/passport ───────────────────────────────
  describe("POST /api/market/passport", () => {
    it("rejects missing X-Wallet", async () => {
      const res = await makeApp().request("/api/market/passport", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PASSPORT_META),
      });
      expect(res.status).toBe(401);
    });

    it("rejects invalid metadata", async () => {
      const res = await makeApp().request("/api/market/passport", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/passport"),
        body: JSON.stringify({ name: "x" }),
      });
      expect(res.status).toBe(400);
    });

    it("mints passport to the signing wallet", async () => {
      const res = await makeApp().request("/api/market/passport", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/passport"),
        body: JSON.stringify(VALID_PASSPORT_META),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.passportId).toBe("1");
      expect(json.owner).toBe(biz.address.toLowerCase());
      expect(json.mintTx).toBe("0xmintpassport");
      expect(ops.mintPassport).toHaveBeenCalledWith(
        biz.address.toLowerCase(),
        expect.stringContaining("/api/market/meta/"),
        365 * 86_400,
      );
    });
  });

  // ─── POST /api/market/services ───────────────────────────────
  describe("POST /api/market/services", () => {
    it("rejects unsigned requests", async () => {
      const res = await makeApp().request("/api/market/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_SERVICE_META),
      });
      expect(res.status).toBe(401);
    });

    it("rejects non-owner wallet", async () => {
      const res = await makeApp().request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(other, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      expect(res.status).toBe(403);
      expect(ops.registerService).not.toHaveBeenCalled();
    });

    it("rejects invalid/revoked passport", async () => {
      ops = fakeOps({ passportValid: vi.fn(async () => false) });
      configureMarketplaceForTesting({ ops });
      const res = await makeApp().request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      expect(res.status).toBe(403);
    });

    it("registers service on-chain + catalogs it", async () => {
      const res = await makeApp().request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.serviceId).toBe(SVC_ID);
      expect(json.buyUrl).toContain(`/api/market/buy/${SVC_ID}`);
      expect(ops.registerService).toHaveBeenCalledWith(
        PASSPORT_ID,
        subIdToBytes32(SUB_ID),
        5_000_000n,
        expect.stringContaining("/api/market/meta/"),
      );
      expect(listServices()).toHaveLength(1);
    });
  });

  // ─── Catalog GETs ────────────────────────────────────────────
  describe("catalog", () => {
    beforeEach(async () => {
      await makeApp().request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
    });

    it("GET /services lists with buyUrl", async () => {
      const res = await makeApp().request("/api/market/services");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.services).toHaveLength(1);
      expect(json.services[0].serviceId).toBe(SVC_ID);
      expect(json.services[0].buyUrl).toContain("/api/market/buy/");
    });

    it("filters by category and q", async () => {
      const app = makeApp();
      expect(
        (await (await app.request("/api/market/services?category=data")).json())
          .services,
      ).toHaveLength(1);
      expect(
        (await (await app.request("/api/market/services?category=nope")).json())
          .services,
      ).toHaveLength(0);
      expect(
        (await (await app.request("/api/market/services?q=search")).json())
          .services,
      ).toHaveLength(1);
      expect(
        (await (await app.request("/api/market/services?q=zzz")).json())
          .services,
      ).toHaveLength(0);
    });

    it("GET /services/:id returns detail, 404 unknown", async () => {
      const app = makeApp();
      const ok = await app.request(`/api/market/services/${SVC_ID}`);
      expect(ok.status).toBe(200);
      expect((await ok.json()).name).toBe("Acme Search API");
      const missing = await app.request(
        `/api/market/services/${"0x".concat("ab".repeat(32))}`,
      );
      expect(missing.status).toBe(404);
    });
  });

  // ─── POST /api/market/buy/:serviceId ─────────────────────────
  describe("POST /api/market/buy/:serviceId", () => {
    it("404 for unknown service, 200 receipt for known", async () => {
      const app = makeApp();
      const missing = await app.request(
        `/api/market/buy/${"0x".concat("cd".repeat(32))}`,
        { method: "POST" },
      );
      expect(missing.status).toBe(404);

      await app.request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      const res = await app.request(`/api/market/buy/${SVC_ID}`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.purchased).toBe(true);
      expect(json.serviceId).toBe(SVC_ID);
    });
  });

  // ─── GET /api/market/passes/:wallet ──────────────────────────
  describe("GET /api/market/passes/:wallet", () => {
    it("rejects invalid wallet", async () => {
      const res = await makeApp().request("/api/market/passes/notanaddr");
      expect(res.status).toBe(400);
    });

    it("lists passes with expiry", async () => {
      const future = BigInt(Math.floor(Date.now() / 1000) + 86_400);
      ops = fakeOps({
        servicePassOf: vi.fn(async () => 7n),
        passExpiresAt: vi.fn(async () => future),
      });
      configureMarketplaceForTesting({ ops });
      const app = makeApp();
      await app.request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      const res = await app.request(`/api/market/passes/${BUYER}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.passes).toHaveLength(1);
      expect(json.passes[0].tokenId).toBe("7");
      expect(json.passes[0].active).toBe(true);
    });
  });

  // ─── GET /api/market/meta/:hash ──────────────────────────────
  describe("GET /api/market/meta/:hash", () => {
    it("serves locally pinned metadata, 404 unknown", async () => {
      const app = makeApp();
      await app.request("/api/market/passport", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/passport"),
        body: JSON.stringify(VALID_PASSPORT_META),
      });
      const hash = (ops.mintPassport as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string;
      const metaHash = hash.split("/").pop()!;
      const res = await app.request(`/api/market/meta/${metaHash}`);
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe("Acme AI");
      expect(
        (await app.request("/api/market/meta/deadbeef")).status,
      ).toBe(404);
    });
  });

  // ─── afterSettle hook: credit + mint ─────────────────────────
  describe("createMarketplaceMintOnSettleHook", () => {
    const settleCtx = (overrides: Record<string, unknown> = {}) => ({
      result: {
        success: true,
        payer: BUYER,
        amount: "5000000",
        transaction: "0xpaytx",
        ...overrides,
      },
      transportContext: {
        request: { path: `/api/market/buy/${SVC_ID}` },
      },
    });

    it("credits splitter + mints service pass on settled buy", async () => {
      const app = makeApp();
      await app.request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      await createMarketplaceMintOnSettleHook()(settleCtx());
      expect(ops.creditPayment).toHaveBeenCalledWith(SVC_ID, 5_000_000n);
      expect(ops.mintServicePass).toHaveBeenCalledWith(
        BUYER,
        SVC_ID,
        30 * 86_400,
        0n,
      );
    });

    it("skips on failed settle / missing payer", async () => {
      const hook = createMarketplaceMintOnSettleHook();
      await hook(settleCtx({ success: false }));
      await hook(settleCtx({ payer: undefined }));
      expect(ops.creditPayment).not.toHaveBeenCalled();
      expect(ops.mintServicePass).not.toHaveBeenCalled();
    });

    it("skips unknown serviceId (no phantom credit)", async () => {
      const hook = createMarketplaceMintOnSettleHook();
      await hook({
        result: { success: true, payer: BUYER, amount: "5000000" },
        transportContext: {
          request: {
            path: `/api/market/buy/${"0x".concat("ef".repeat(32))}`,
          },
        },
      });
      expect(ops.creditPayment).not.toHaveBeenCalled();
      expect(ops.mintServicePass).not.toHaveBeenCalled();
    });

    it("logs but doesn't throw when chain ops fail", async () => {
      ops = fakeOps({
        creditPayment: vi.fn(async () => {
          throw new Error("rpc down");
        }),
        mintServicePass: vi.fn(async () => {
          throw new Error("mint reverted");
        }),
      });
      configureMarketplaceForTesting({ ops });
      const app = makeApp();
      await app.request("/api/market/services", {
        method: "POST",
        headers: await sigHeaders(biz, "POST", "/api/market/services"),
        body: JSON.stringify(VALID_SERVICE_META),
      });
      await expect(
        createMarketplaceMintOnSettleHook()(settleCtx()),
      ).resolves.toBeUndefined();
    });
  });
});
