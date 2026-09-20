import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  buildAccessChallenge,
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
  type AgentAuthVariables,
} from "../../src/server/middleware/agent-auth";
import { marketplaceApiRoutes } from "../../src/server/routes/marketplace-api";
import { marketplacePageRoutes } from "../../src/server/routes/marketplace-pages";
import {
  configureMarketplaceForTesting,
  resetMarketplaceForTesting,
  useMemoryStoreForTesting,
  createMarketplaceMintOnSettleHook,
  serviceIdFor,
  subIdToBytes32,
  type MarketplaceOps,
} from "../../src/server/lib/marketplace";
import { resetConfigCache } from "../../src/config/env";
// Demo services from @agentbadge/pass-auth (SLICE-138-6) — exercised
// end-to-end against the fake chain via accessChecker.
import { createWeatherApp } from "../../../../packages/pass-auth/demo/weather-api/index.js";
import { createFortuneApp } from "../../../../packages/pass-auth/demo/fortune-mcp/index.js";
import {
  signChallenge,
  clearAccessCache,
} from "../../../../packages/pass-auth/src/index.js";

/**
 * SLICE-138-7: E2E — full marketplace loop.
 *
 * Business onboards → service live → buyer purchases (simulated x402
 * settle → afterSettle hook) → calls demo API + MCP → renewal →
 * revocation grace. Chain = in-memory MarketplaceOps implementing real
 * contract semantics (passport validity, revocation, renewal on same
 * tokenId, splitter 90/10 bookkeeping, mutable block time).
 */

const BIZ_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const BUYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const biz = privateKeyToAccount(BIZ_KEY);
const buyer = privateKeyToAccount(BUYER_KEY);
// Simulated ERC-1271 contract wallet (AA buyer) — no private key.
const AA_WALLET = "0x1111111111111111111111111111111111111271";
const TREASURY = "0xcdd23d104aa4c10de65f4dd0571edfec0458699d";

// ─── Fake chain ────────────────────────────────────────────────
interface FakeChain {
  ops: MarketplaceOps;
  state: {
    now: number;
    nextTokenId: bigint;
    passports: Map<
      bigint,
      { owner: string; expiresAt: number; revoked: boolean }
    >;
    services: Map<
      string,
      { passportId: bigint; price: bigint; metaURI: string; active: boolean }
    >;
    passes: Map<
      bigint,
      { owner: string; serviceId: string; expiresAt: number; revoked: boolean }
    >;
    passByWalletService: Map<string, bigint>;
    credits: {
      serviceId: string;
      amount: bigint;
      payee: bigint;
      treasury: bigint;
    }[];
  };
  advanceTime(sec: number): void;
  revokePassport(id: bigint): void;
  hasAccess(wallet: string, serviceId: string): boolean;
}

function makeFakeChain(): FakeChain {
  const state: FakeChain["state"] = {
    now: Math.floor(Date.now() / 1000),
    nextTokenId: 1n,
    passports: new Map(),
    services: new Map(),
    passes: new Map(),
    passByWalletService: new Map(),
    credits: [],
  };

  const ops: MarketplaceOps = {
    mintPassport: vi.fn(
      async (to: string, _metaURI: string, durationSec: number) => {
        const id = state.nextTokenId++;
        state.passports.set(id, {
          owner: to.toLowerCase(),
          expiresAt: state.now + durationSec,
          revoked: false,
        });
        return `0xmintpassport${id}`;
      },
    ),
    registerService: vi.fn(
      async (
        passportId: bigint,
        subId32: `0x${string}`,
        price: bigint,
        metaURI: string,
      ) => {
        const p = state.passports.get(passportId);
        if (!p || p.revoked || p.expiresAt <= state.now) {
          throw new Error("InvalidPassport");
        }
        const serviceId = serviceIdFor(passportId, subId32);
        state.services.set(serviceId, {
          passportId,
          price,
          metaURI,
          active: true,
        });
        return `0xregsvc${serviceId.slice(0, 8)}`;
      },
    ),
    mintServicePass: vi.fn(
      async (
        to: string,
        serviceId: `0x${string}`,
        durationSec: number,
        _agentId: bigint,
      ) => {
        const svc = state.services.get(serviceId);
        if (!svc || !svc.active) throw new Error("ServiceInactive");
        const key = `${to.toLowerCase()}:${serviceId}`;
        const existing = state.passByWalletService.get(key);
        if (existing) {
          // Renewal: same tokenId, expiry extends from max(now, current).
          const pass = state.passes.get(existing)!;
          pass.expiresAt = Math.max(state.now, pass.expiresAt) + durationSec;
          return `0xrenew${existing}`;
        }
        const id = state.nextTokenId++;
        state.passes.set(id, {
          owner: to.toLowerCase(),
          serviceId,
          expiresAt: state.now + durationSec,
          revoked: false,
        });
        state.passByWalletService.set(key, id);
        return `0xmintsvc${id}`;
      },
    ),
    creditPayment: vi.fn(async (serviceId: `0x${string}`, amount: bigint) => {
      // Splitter semantics (SLICE-138-2): 90% payee, 10% treasury.
      state.credits.push({
        serviceId,
        amount,
        payee: (amount * 90n) / 100n,
        treasury: (amount * 10n) / 100n,
      });
      return "0xcredit";
    }),
    passportOf: vi.fn(async (wallet: string) => {
      for (const [id, p] of state.passports) {
        if (p.owner === wallet.toLowerCase()) return id;
      }
      return 0n;
    }),
    passportValid: vi.fn(async (id: bigint) => {
      const p = state.passports.get(id);
      return !!p && !p.revoked && p.expiresAt > state.now;
    }),
    passportOwner: vi.fn(async (id: bigint) => {
      return state.passports.get(id)?.owner ?? "0x0";
    }),
    getService: vi.fn(async (serviceId: `0x${string}`) => {
      return state.services.get(serviceId) ?? null;
    }),
    servicePassOf: vi.fn(
      async (wallet: string, serviceId: `0x${string}`) => {
        return (
          state.passByWalletService.get(
            `${wallet.toLowerCase()}:${serviceId}`,
          ) ?? 0n
        );
      },
    ),
    passExpiresAt: vi.fn(async (tokenId: bigint) => {
      // Passes store expiry in fake time; the route compares against real
      // wall clock — translate by the accumulated fake-time offset.
      const offset = state.now - Math.floor(Date.now() / 1000);
      const exp = state.passes.get(tokenId)?.expiresAt ?? 0;
      return BigInt(Math.max(0, exp - offset));
    }),
  };

  return {
    ops,
    state,
    advanceTime(sec) {
      state.now += sec;
    },
    revokePassport(id) {
      const p = state.passports.get(id);
      if (p) p.revoked = true;
    },
    // Mirrors MarketplacePassNFT.hasAccess: active service + live pass.
    hasAccess(wallet, serviceId) {
      const svc = state.services.get(serviceId);
      if (!svc?.active) return false;
      const id = state.passByWalletService.get(
        `${wallet.toLowerCase()}:${serviceId}`,
      );
      if (!id) return false;
      const pass = state.passes.get(id)!;
      return !pass.revoked && pass.expiresAt > state.now;
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────
async function sigHeaders(account: typeof biz, method: string, path: string) {
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

function makeApp() {
  const app = new Hono<{ Variables: AgentAuthVariables }>();
  app.route("/api", marketplaceApiRoutes);
  app.route("/", marketplacePageRoutes);
  return app;
}

const localVerifier = async (
  wallet: string,
  message: string,
  signature: string,
) =>
  verifyMessage({
    address: wallet as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });

/** Simulated x402 settle → invoke the afterSettle hook directly. */
async function settleBuy(
  hook: ReturnType<typeof createMarketplaceMintOnSettleHook>,
  payer: string,
  serviceId: string,
  amount: string,
) {
  await hook({
    result: {
      success: true,
      payer,
      transaction: `0xpay${Date.now()}`,
      amount,
    },
    requirements: { amount },
    transportContext: { request: { path: `/api/market/buy/${serviceId}` } },
  });
}

const PASSPORT_META = {
  name: "Acme AI",
  endpointUrl: "https://api.acme.example",
  category: "data",
  description: "Acme data API",
  docsUrl: "https://docs.acme.example",
};

const SERVICE_META = {
  passportTokenId: "1",
  subId: "api",
  name: "Acme Search API",
  priceUsd: "5.00",
  durationDays: 30,
  description: "Search endpoint",
  category: "data",
};

const SVC_ID = serviceIdFor(1n, subIdToBytes32("api"));

describe("SLICE-138-7: marketplace e2e", () => {
  let chain: FakeChain;
  let hook: ReturnType<typeof createMarketplaceMintOnSettleHook>;

  beforeEach(() => {
    process.env.MOCK_HEDERA = "true";
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
    process.env.MOCK_IPFS = "true";
    process.env.MARKETPLACE_ENABLED = "true";
    process.env.MARKETPLACE_NFT =
      "0xb42f7c30e4dc14877dac7948bfcb2db455df2962";
    process.env.MARKETPLACE_SPLITTER =
      "0xbfc6b4c980e979dccaaebb4caf875e1b8e9b2b42";
    process.env.MARKETPLACE_TREASURY = TREASURY;
    // Demo apps read SERVICE_ID/DOMAIN inside their factories.
    process.env.SERVICE_ID = SVC_ID;
    process.env.DOMAIN = "demo.test";
    resetConfigCache();
    useMemoryStoreForTesting();
    chain = makeFakeChain();
    configureMarketplaceForTesting({ ops: chain.ops });
    configureAgentAuthForTesting({ verifier: localVerifier });
    hook = createMarketplaceMintOnSettleHook();
  });

  afterEach(() => {
    resetMarketplaceForTesting();
    resetAgentAuthForTesting();
    delete process.env.SERVICE_ID;
    delete process.env.DOMAIN;
  });

  async function onboardBusiness() {
    const app = makeApp();
    const pRes = await app.request("/api/market/passport", {
      method: "POST",
      headers: await sigHeaders(biz, "POST", "/api/market/passport"),
      body: JSON.stringify(PASSPORT_META),
    });
    expect(pRes.status).toBe(200);
    const { passportId } = await pRes.json();
    expect(passportId).toBe("1");

    const sRes = await app.request("/api/market/services", {
      method: "POST",
      headers: await sigHeaders(biz, "POST", "/api/market/services"),
      body: JSON.stringify(SERVICE_META),
    });
    expect(sRes.status).toBe(200);
    const svc = await sRes.json();
    expect(svc.serviceId).toBe(SVC_ID);
    expect(svc.buyUrl).toContain(`/market/buy/${SVC_ID}`);
    return svc;
  }

  /** Demo weather app wired to the fake chain. */
  function weatherDemo() {
    return createWeatherApp({
      verifier: localVerifier,
      accessChecker: async (w: string, sid: string) =>
        chain.hasAccess(w, sid),
    });
  }

  async function weatherCall(wallet: typeof buyer | { address: string }) {
    const { signature, timestamp } = await signChallenge(buyer, "demo.test");
    return weatherDemo().request("/weather/tokyo", {
      headers: {
        "x-agent-wallet": wallet.address,
        "x-agent-signature": signature,
        "x-agent-timestamp": String(timestamp),
      },
    });
  }

  it("full loop: onboard → catalog → buy → split → pass → demo API 200", async () => {
    const app = makeApp();

    // 1. Business onboards (passport mint + service registration).
    await onboardBusiness();

    // 2. Service appears in catalog (API + UI page).
    const cat = await app.request("/api/market/services");
    const services = (await cat.json()).services;
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("Acme Search API");
    const page = await app.request(`/market/services/${SVC_ID}`);
    expect(await page.text()).toContain("Acme Search API");

    // 3. Buyer purchases (simulated x402 settle → afterSettle hook).
    await settleBuy(hook, buyer.address, SVC_ID, "5000000");

    // 4. Split verified: 90% payee / 10% treasury bookkeeping.
    expect(chain.state.credits).toHaveLength(1);
    expect(chain.state.credits[0].amount).toBe(5_000_000n);
    expect(chain.state.credits[0].payee).toBe(4_500_000n);
    expect(chain.state.credits[0].treasury).toBe(500_000n);

    // 5. Pass minted — visible via API.
    const passes = await app.request(`/api/market/passes/${buyer.address}`);
    const passList = (await passes.json()).passes;
    expect(passList).toHaveLength(1);
    expect(passList[0].serviceId).toBe(SVC_ID);
    expect(passList[0].active).toBe(true);

    // 6. Buyer calls demo API with pass-auth signature → 200.
    const wRes = await weatherCall(buyer);
    expect(wRes.status).toBe(200);
    const wBody = await wRes.json();
    expect(wBody.city).toBe("tokyo");
    expect(wBody.payer).toBe(buyer.address.toLowerCase());
  });

  it("AA buyer (ERC-1271): settle → pass → demo API via mocked 1271", async () => {
    await onboardBusiness();
    await settleBuy(hook, AA_WALLET, SVC_ID, "5000000");
    expect(chain.hasAccess(AA_WALLET, SVC_ID)).toBe(true);

    // AA wallet "signs" — verifier mock emulates ERC-1271 isValidSignature.
    const aaVerifier = async (wallet: string) =>
      wallet.toLowerCase() === AA_WALLET.toLowerCase();
    const weather = createWeatherApp({
      verifier: aaVerifier,
      accessChecker: async (w: string, sid: string) =>
        chain.hasAccess(w, sid),
    });
    const res = await weather.request("/weather/tokyo", {
      headers: {
        "x-agent-wallet": AA_WALLET,
        "x-agent-signature": "0x1271sig",
        "x-agent-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).payer).toBe(AA_WALLET.toLowerCase());
  });

  it("MCP: token exchange → bearer → get_fortune", async () => {
    await onboardBusiness();
    await settleBuy(hook, buyer.address, SVC_ID, "5000000");

    const fortune = createFortuneApp({
      verifier: localVerifier,
      accessChecker: async (w: string, sid: string) =>
        chain.hasAccess(w, sid),
      secret: "e2e",
    });
    const { signature, timestamp } = await signChallenge(buyer, "demo.test");
    const tokenRes = await fortune.request("/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: buyer.address,
        signature,
        timestamp,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const { token } = await tokenRes.json();
    expect(token).toBeTruthy();

    const call = await fortune.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_fortune", arguments: { topic: "e2e" } },
      }),
    });
    expect(call.status).toBe(200);
    const body = await call.json();
    expect(body.result.content[0].text).toContain("[e2e]");
    expect(body.result.content[0].text).toContain(
      buyer.address.toLowerCase(),
    );
  });

  it("renewal: second purchase → same tokenId, extended expiry", async () => {
    const app = makeApp();
    await onboardBusiness();
    await settleBuy(hook, buyer.address, SVC_ID, "5000000");

    const first = (
      await (
        await app.request(`/api/market/passes/${buyer.address}`)
      ).json()
    ).passes[0];
    const firstExpiry = first.expiresAt;

    // Advance 10 days, renew → same tokenId, expiry = old + 30d.
    chain.advanceTime(10 * 86_400);
    await settleBuy(hook, buyer.address, SVC_ID, "5000000");

    const second = (
      await (
        await app.request(`/api/market/passes/${buyer.address}`)
      ).json()
    ).passes[0];
    expect(second.tokenId).toBe(first.tokenId);
    // Renewal adds 30d from max(now, prevExpiry) = prevExpiry + 30d in
    // chain time; reported in real-clock terms that's +20d (10d elapsed).
    expect(second.expiresAt).toBe(firstExpiry + 20 * 86_400);
    expect(chain.state.credits).toHaveLength(2);
  });

  it("revocation grace: revoke passport → reg blocked, pass lives, expires → inactive", async () => {
    const app = makeApp();
    await onboardBusiness();
    await settleBuy(hook, buyer.address, SVC_ID, "5000000");

    // Revoke business passport.
    chain.revokePassport(1n);

    // New service registration blocked (passportValid → false).
    const regRes = await app.request("/api/market/services", {
      method: "POST",
      headers: await sigHeaders(biz, "POST", "/api/market/services"),
      body: JSON.stringify({ ...SERVICE_META, subId: "api2" }),
    });
    expect(regRes.status).toBe(403);

    // Existing pass still works (grace, D9-B) — demo API still 200.
    expect(chain.hasAccess(buyer.address, SVC_ID)).toBe(true);
    expect((await weatherCall(buyer)).status).toBe(200);
    const passes = await app.request(`/api/market/passes/${buyer.address}`);
    expect((await passes.json()).passes[0].active).toBe(true);

    // Advance past expiry → access dies naturally → demo API 402.
    // (clearAccessCache: pass-auth caches positives 300s — in prod the
    // cache expires on its own within the window.)
    chain.advanceTime(31 * 86_400);
    clearAccessCache();
    expect(chain.hasAccess(buyer.address, SVC_ID)).toBe(false);
    expect((await weatherCall(buyer)).status).toBe(402);
    const expired = await app.request(`/api/market/passes/${buyer.address}`);
    expect((await expired.json()).passes[0].active).toBe(false);
  });

  it("negatives: no passport → reg fails; bad sig → 401; unknown service → 404", async () => {
    const app = makeApp();

    // Register without passport → 403.
    const regRes = await app.request("/api/market/services", {
      method: "POST",
      headers: await sigHeaders(biz, "POST", "/api/market/services"),
      body: JSON.stringify(SERVICE_META),
    });
    expect(regRes.status).toBe(403);

    // Bad signature → 401.
    const badHeaders = await sigHeaders(biz, "POST", "/api/market/services");
    badHeaders["x-sig"] = "0xdeadbeef";
    const badSig = await app.request("/api/market/services", {
      method: "POST",
      headers: badHeaders,
      body: JSON.stringify(SERVICE_META),
    });
    expect(badSig.status).toBe(401);

    // Unknown service detail → 404.
    const unknown = await app.request(
      `/market/services/${"0x".concat("ff".repeat(32))}`,
    );
    expect(unknown.status).toBe(404);
  });
});
