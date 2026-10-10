import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createAgentRegisterRoutes } from "../src/server/routes/agents-register-api";
import { createMemoryAgentRegistrationStore } from "../src/server/lib/agent-registration/store";
import {
  buildAgentUri,
  createDailyLimiter,
  registerAgent,
  RegistrationError,
} from "../src/server/lib/agent-registration/register";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const CHAIN_ID = 5042;

function makeDeps(overrides: Record<string, unknown> = {}) {
  const store = createMemoryAgentRegistrationStore();
  const mint = async (agentUri: string) => {
    void agentUri;
    return { agentId: 42n, txHash: "0xdeadbeef" as `0x${string}` };
  };
  return {
    enabled: true,
    store,
    mint,
    chainId: CHAIN_ID,
    registryAddress: REGISTRY,
    keyRpm: 10,
    dailyLimit: 20,
    // In-memory regcap — the real Valkey cache shares counters across runs.
    cache: null,
    ...overrides,
  };
}

function app(deps: ReturnType<typeof makeDeps>) {
  return new Hono().route("/", createAgentRegisterRoutes(deps));
}

const post = (a: Hono, body: unknown, headers: Record<string, string> = {}) =>
  a.request("/api/v1/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/* ------------------------------- lib ----------------------------------- */

describe("buildAgentUri", () => {
  it("produces a data-URI registration-v1 doc with name + service endpoint", () => {
    const uri = buildAgentUri({
      name: "my-agent",
      endpoint: "https://agent.example.com",
      capabilities: ["search"],
    });
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const doc = JSON.parse(
      Buffer.from(uri.split(",")[1], "base64").toString("utf8"),
    );
    expect(doc.type).toContain("eip-8004#registration-v1");
    expect(doc.name).toBe("my-agent");
    expect(doc.services[0].endpoint).toBe("https://agent.example.com");
    expect(doc.capabilities).toEqual(["search"]);
    expect(doc.x402Support).toBe(true);
    expect(uri.length).toBeLessThanOrEqual(2048);
  });

  it("sheds oversized fields and marks them truncated (≤2KB)", () => {
    const uri = buildAgentUri({
      name: "x",
      description: "d".repeat(4000),
      capabilities: ["search"],
    });
    expect(uri.length).toBeLessThanOrEqual(2048);
    const doc = JSON.parse(
      Buffer.from(uri.split(",")[1], "base64").toString("utf8"),
    );
    expect(doc.description).toBeUndefined();
    expect(doc.truncated).toContain("description");
  });
});

describe("registerAgent", () => {
  it("rejects invalid input before minting", async () => {
    const deps = makeDeps();
    let minted = false;
    const mint = async (u: string) => {
      minted = true;
      return deps.mint(u);
    };
    await expect(
      registerAgent({ ...deps, mint }, { name: "" }),
    ).rejects.toBeInstanceOf(RegistrationError);
    expect(minted).toBe(false);
  });

  it("mint failure → execution_failed, no record persisted", async () => {
    const deps = makeDeps({
      mint: async () => {
        throw new Error("rpc down");
      },
    });
    await expect(
      registerAgent(deps, { name: "a" }),
    ).rejects.toMatchObject({ code: "execution_failed" });
    expect(await deps.store.list()).toEqual([]);
  });

  it("happy path — record has keyHash only, apiKey returned once", async () => {
    const deps = makeDeps();
    const { record, apiKey } = await registerAgent(deps, { name: "a" });
    expect(apiKey).toMatch(/^agb_/);
    expect(record.agentId).toBe(`eip155:${CHAIN_ID}:${REGISTRY}:42`);
    expect(record.registryTx).toBe("0xdeadbeef");
    expect(record.tier).toBe("observer");
    expect(record.status).toBe("active");
    expect(JSON.stringify(record)).not.toContain(apiKey);
  });
});

describe("createDailyLimiter", () => {
  it("allows `limit` then blocks", async () => {
    const l = createDailyLimiter(2);
    expect(await l.allow("ip1")).toBe(true);
    expect(await l.allow("ip1")).toBe(true);
    expect(await l.allow("ip1")).toBe(false);
    expect(await l.allow("ip2")).toBe(true);
  });
});

/* ------------------------------ routes ---------------------------------- */

describe("POST /api/v1/agents/register", () => {
  it("201 → agent_id, registry_tx, api_key, tier observer", async () => {
    const deps = makeDeps();
    const res = await post(app(deps), { name: "cool-agent" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.agent_id).toBe(`eip155:${CHAIN_ID}:${REGISTRY}:42`);
    expect(body.registry).toBe("erc-8004");
    expect(body.registry_tx).toBe("0xdeadbeef");
    expect(body.api_key).toMatch(/^agb_[A-Za-z0-9_-]{43}$/);
    expect(body.tier).toBe("observer");
    expect(body.next_call.path).toBe("/api/v1/agents/me");
  });

  it("api_key shown once — stored record carries hash only", async () => {
    const deps = makeDeps();
    const res = await post(app(deps), { name: "once" });
    const body = await res.json();
    const rec = (await deps.store.get(body.agent_id))!;
    expect(rec.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rec)).not.toContain(body.api_key);
  });

  it("mint failure → 502 execution_failed, no record", async () => {
    const deps = makeDeps({
      mint: async () => {
        throw new Error("revert");
      },
    });
    const res = await post(app(deps), { name: "x" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("execution_failed");
    expect(await deps.store.list()).toEqual([]);
  });

  it("disabled feature → 503 honest code", async () => {
    const res = await post(app(makeDeps({ enabled: false })), { name: "x" });
    expect(res.status).toBe(503);
  });

  it("missing ops signer → 503 (no silent mint)", async () => {
    const res = await post(app(makeDeps({ mint: undefined })), { name: "x" });
    expect(res.status).toBe(503);
  });

  it("invalid body → 400", async () => {
    const deps = makeDeps();
    expect((await post(app(deps), {})).status).toBe(400);
    expect((await post(app(deps), { name: "a".repeat(81) })).status).toBe(400);
    expect(
      (await post(app(deps), { name: "a", endpoint: "ftp://x" })).status,
    ).toBe(400);
  });

  it("daily limit → 429 register_rate_limited", async () => {
    const deps = makeDeps({ dailyLimit: 1 });
    const a = app(deps);
    expect((await post(a, { name: "one" })).status).toBe(201);
    const res = await post(a, { name: "two" });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("register_rate_limited");
  });
});

describe("GET/DELETE /api/v1/agents/me", () => {
  let deps: ReturnType<typeof makeDeps>;
  let key = "";
  beforeEach(async () => {
    deps = makeDeps();
    const res = await post(app(deps), { name: "me-agent" });
    key = (await res.json()).api_key;
  });

  it("GET without key → 401 agent_key_invalid", async () => {
    const res = await app(deps).request("/api/v1/agents/me");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("agent_key_invalid");
  });

  it("GET with malformed key → 401 (no store hit)", async () => {
    const res = await app(deps).request("/api/v1/agents/me", {
      headers: { authorization: "Bearer not-a-key" },
    });
    expect(res.status).toBe(401);
  });

  it("GET returns record without keyHash", async () => {
    const res = await app(deps).request("/api/v1/agents/me", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("me-agent");
    expect(body.tier).toBe("observer");
    expect(body.reputation).toBeNull();
    expect(body.keyHash).toBeUndefined();
  });

  it("DELETE self-revokes; subsequent GET → 401 agent_key_revoked", async () => {
    const a = app(deps);
    const auth = { authorization: `Bearer ${key}` };
    const del = await a.request("/api/v1/agents/me", {
      method: "DELETE",
      headers: auth,
    });
    expect(del.status).toBe(200);
    expect((await del.json()).status).toBe("revoked");
    const res = await a.request("/api/v1/agents/me", { headers: auth });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("agent_key_revoked");
  });

  it("freshly registered second agent's key works after first is revoked", async () => {
    const a = app(deps);
    await a.request("/api/v1/agents/me", {
      method: "DELETE",
      headers: { authorization: `Bearer ${key}` },
    });
    const res2 = await post(a, { name: "agent-two" });
    const key2 = (await res2.json()).api_key;
    const me = await a.request("/api/v1/agents/me", {
      headers: { authorization: `Bearer ${key2}` },
    });
    expect(me.status).toBe(200);
  });
});

/* ---------------------- sponsored registration (SLICE-184-5) ---------------------- */

import { privateKeyToAccount } from "viem/accounts";
import {
  buildRegisterIntent,
  verifyRegisterIntent,
} from "../src/server/lib/agent-registration/intent";
import type { SponsoredMintFn } from "../src/server/lib/agent-registration/register";

// Anvil #0 key — public test key, address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_KEY);
const TEST_OWNER = TEST_ACCOUNT.address;

const okSponsoredMint: SponsoredMintFn = async (_uri, _owner) => ({
  agentId: 77n,
  txHash: "0xmint77" as `0x${string}`,
  ownerTxHash: "0xtransfer77" as `0x${string}`,
});

const signIntent = (name: string) =>
  TEST_ACCOUNT.signMessage({
    message: buildRegisterIntent(CHAIN_ID, REGISTRY, TEST_OWNER, name),
  });

describe("verifyRegisterIntent", () => {
  it("round-trip: correct signer+message verifies", async () => {
    const signature = await signIntent("spon-agent");
    expect(
      await verifyRegisterIntent({
        chainId: CHAIN_ID,
        registryAddress: REGISTRY,
        owner: TEST_OWNER,
        name: "spon-agent",
        signature,
      }),
    ).toBe(true);
  });

  it("rejects wrong name (bound field mismatch)", async () => {
    const signature = await signIntent("spon-agent");
    expect(
      await verifyRegisterIntent({
        chainId: CHAIN_ID,
        registryAddress: REGISTRY,
        owner: TEST_OWNER,
        name: "other-agent",
        signature,
      }),
    ).toBe(false);
  });

  it("rejects wrong owner + malformed inputs without throwing", async () => {
    const signature = await signIntent("spon-agent");
    expect(
      await verifyRegisterIntent({
        chainId: CHAIN_ID,
        registryAddress: REGISTRY,
        owner: "0x0000000000000000000000000000000000000001",
        name: "spon-agent",
        signature,
      }),
    ).toBe(false);
    expect(
      await verifyRegisterIntent({
        chainId: CHAIN_ID,
        registryAddress: REGISTRY,
        owner: "0x123" as `0x${string}`,
        name: "x",
        signature: "0x00" as `0x${string}`,
      }),
    ).toBe(false);
  });
});

describe("registerAgent — sponsored path", () => {
  it("owner → calls sponsoredMint, record has owner/sponsored/ownerTx", async () => {
    const deps = makeDeps();
    let called = false;
    const sponsoredMint: SponsoredMintFn = async (uri, owner) => {
      called = true;
      expect(uri).toContain("data:application/json");
      expect(owner).toBe(TEST_OWNER);
      return okSponsoredMint(uri, owner);
    };
    const { record } = await registerAgent(
      { ...deps, sponsoredMint },
      { name: "spon", owner: TEST_OWNER },
    );
    expect(called).toBe(true);
    expect(record.owner).toBe(TEST_OWNER);
    expect(record.sponsored).toBe(true);
    expect(record.ownerTx).toBe("0xtransfer77");
    expect(record.agentId).toBe(`eip155:${CHAIN_ID}:${REGISTRY}:77`);
  });

  it("owner without sponsoredMint → execution_failed (no silent fallback)", async () => {
    const deps = makeDeps();
    await expect(
      registerAgent(deps, { name: "spon", owner: TEST_OWNER }),
    ).rejects.toMatchObject({ code: "execution_failed" });
    expect(await deps.store.list()).toEqual([]);
  });

  it("bad owner address → invalid_input before mint", async () => {
    const deps = makeDeps({ sponsoredMint: okSponsoredMint });
    await expect(
      registerAgent(deps, { name: "s", owner: "0x123" as `0x${string}` }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("POST /api/v1/agents/register — sponsored", () => {
  it("owner+signature with sponsored off → 400", async () => {
    const deps = makeDeps(); // no sponsoredMint → sponsored disabled
    const res = await post(app(deps), {
      name: "spon",
      owner: TEST_OWNER,
      signature: await signIntent("spon"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not enabled");
  });

  it("owner without signature → 400", async () => {
    const deps = makeDeps({ sponsoredMint: okSponsoredMint });
    const res = await post(app(deps), { name: "spon", owner: TEST_OWNER });
    expect(res.status).toBe(400);
  });

  it("bad signature → 400 invalid intent", async () => {
    const deps = makeDeps({ sponsoredMint: okSponsoredMint });
    const res = await post(app(deps), {
      name: "spon",
      owner: TEST_OWNER,
      signature: await signIntent("different-name"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("intent signature");
  });

  it("valid intent → 201 with sponsored fields; /me exposes owner", async () => {
    const deps = makeDeps({ sponsoredMint: okSponsoredMint });
    const a = app(deps);
    const res = await post(a, {
      name: "spon",
      owner: TEST_OWNER,
      signature: await signIntent("spon"),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sponsored).toBe(true);
    expect(body.owner).toBe(TEST_OWNER);
    expect(body.owner_tx).toBe("0xtransfer77");
    expect(body.agent_id).toBe(`eip155:${CHAIN_ID}:${REGISTRY}:77`);
    const me = await a.request("/api/v1/agents/me", {
      headers: { authorization: `Bearer ${body.api_key}` },
    });
    const rec = await me.json();
    expect(rec.owner).toBe(TEST_OWNER);
    expect(rec.sponsored).toBe(true);
  });

  it("sponcap → second sponsored mint 429 sponsored_quota_exceeded", async () => {
    const deps = makeDeps({
      sponsoredMint: okSponsoredMint,
      sponsoredDailyLimit: 1,
      dailyLimit: 99,
    });
    const a = app(deps);
    const ip1 = { "x-forwarded-for": "10.5.0.1" };
    const ip2 = { "x-forwarded-for": "10.5.0.2" };
    const first = await post(
      a,
      { name: "s1", owner: TEST_OWNER, signature: await signIntent("s1") },
      ip1,
    );
    expect(first.status).toBe(201);
    // Second sponsored attempt — different IP (regcap passes) but global cap hit.
    const res = await post(
      a,
      { name: "s2", owner: TEST_OWNER, signature: await signIntent("s2") },
      ip2,
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("sponsored_quota_exceeded");
  });

  it("per-IP regcap fires BEFORE sponcap (sybil order)", async () => {
    const deps = makeDeps({
      sponsoredMint: okSponsoredMint,
      sponsoredDailyLimit: 50,
      dailyLimit: 1,
    });
    const a = app(deps);
    const ip = { "x-forwarded-for": "10.5.9.9" };
    expect(
      (await post(a, { name: "x" }, ip)).status,
    ).toBe(201);
    const res = await post(
      a,
      { name: "s", owner: TEST_OWNER, signature: await signIntent("s") },
      ip,
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("register_rate_limited");
  });
});
