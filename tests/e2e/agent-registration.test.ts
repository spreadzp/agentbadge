/**
 * SLICE-184-4 (EPIC-184): self-serve registration e2e — full cycle,
 * per-IP sybil cap, mint-failure honesty, admin revocation timing.
 *
 * Runs fully in-process: memory store + InMemoryCache standing in for
 * Valkey, stub mint. The agent-key-auth middleware and the route module
 * share BOTH the store and the cache — that's what makes revocation
 * timing assertions meaningful.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { InMemoryCache } from "@agentbadge/cache";

import { createAgentRegisterRoutes } from "../../src/server/routes/agents-register-api";
import {
  agentKeyAuth,
  initAgentKeyAuth,
} from "../../src/server/middleware/agent-key-auth";
import { createMemoryAgentRegistrationStore } from "../../src/server/lib/agent-registration/store";
import type {
  MintFn,
  SponsoredMintFn,
} from "../../src/server/lib/agent-registration/register";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const CHAIN_ID = 5042;
const ADMIN_KEY = "test-admin-key-1844";
// Per-run nonce — IP identity keys the regcap bucket.
const RUN = Math.random().toString(36).slice(2, 8);
const ipOf = (n: number) => ({ "x-forwarded-for": `10.184.${RUN.length}.${n}` });

let tokenSeq = 0n;
const okMint: MintFn = async () => ({
  agentId: ++tokenSeq,
  txHash: `0xmint${tokenSeq.toString(16).padStart(8, "0")}` as `0x${string}`,
});

function makeApp(
  opts: {
    dailyLimit?: number;
    mint?: MintFn;
    sponsoredMint?: SponsoredMintFn;
    sponsoredDailyLimit?: number;
  } = {},
) {
  const store = createMemoryAgentRegistrationStore();
  const cache = new InMemoryCache();
  initAgentKeyAuth({ store, cache, ttlSec: 60 });

  const app = new Hono();
  app.use(agentKeyAuth());
  app.route(
    "/",
    createAgentRegisterRoutes({
      enabled: true,
      store,
      mint: opts.mint ?? okMint,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
      keyRpm: 10,
      dailyLimit: opts.dailyLimit ?? 20,
      cache,
      ...(opts.sponsoredMint ? { sponsoredMint: opts.sponsoredMint } : {}),
      sponsoredDailyLimit: opts.sponsoredDailyLimit ?? 50,
    }),
  );
  return { app, store, cache };
}

const reg = (app: Hono, name: string, headers: Record<string, string> = {}) =>
  app.request("/api/v1/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ name }),
  });
const me = (app: Hono, key: string) =>
  app.request("/api/v1/agents/me", {
    headers: { authorization: `Bearer ${key}` },
  });
const adminDel = (app: Hono, agentId: string, key = ADMIN_KEY) =>
  app.request(`/api/v1/admin/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
    headers: { "x-admin-key": key },
  });

describe("SLICE-184-4 e2e: agent registration cycle", () => {
  const prevAdmin = process.env.ADMIN_API_KEY;
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    tokenSeq = 0n;
  });
  afterEach(() => {
    initAgentKeyAuth(null); // detach global deps between tests
    if (prevAdmin === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevAdmin;
  });

  it("full cycle: register → keyed /me → self-revoke → 401 revoked", async () => {
    const { app } = makeApp();
    const r = await reg(app, "cycle-agent", ipOf(1));
    expect(r.status).toBe(201);
    const { api_key, agent_id, tier } = await r.json();
    expect(tier).toBe("observer");

    const m = await me(app, api_key);
    expect(m.status).toBe(200);
    const rec = await m.json();
    expect(rec.agent_id).toBe(agent_id);
    expect(rec.status).toBe("active");
    expect(rec).not.toHaveProperty("keyHash");

    const d = await app.request("/api/v1/agents/me", {
      method: "DELETE",
      headers: { authorization: `Bearer ${api_key}` },
    });
    expect(d.status).toBe(200);

    const dead = await me(app, api_key);
    expect(dead.status).toBe(401);
    expect((await dead.json()).code).toBe("agent_key_revoked");
  });

  it("per-IP daily cap → 429 register_rate_limited; other IP unaffected", async () => {
    const { app } = makeApp({ dailyLimit: 2 });
    expect((await reg(app, "a", ipOf(2))).status).toBe(201);
    expect((await reg(app, "b", ipOf(2))).status).toBe(201);
    const blocked = await reg(app, "c", ipOf(2));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("register_rate_limited");
    // Different IP — fresh bucket.
    expect((await reg(app, "d", ipOf(3))).status).toBe(201);
  });

  it("mint failure → 502, no record, cap slot still consumed", async () => {
    const mint: MintFn = async () => {
      throw new Error("execution reverted");
    };
    const { app, store } = makeApp({ mint, dailyLimit: 3 });
    const r = await reg(app, "fail-agent", ipOf(4));
    expect(r.status).toBe(502);
    expect((await r.json()).code).toBe("execution_failed");
    expect(await store.list()).toEqual([]);
  });

  it("admin revoke → 200, key dies immediately (cache busted)", async () => {
    const { app } = makeApp();
    const r = await reg(app, "admin-target", ipOf(5));
    const { api_key, agent_id } = await r.json();

    // Prime the 60s auth cache with a successful keyed call.
    expect((await me(app, api_key)).status).toBe(200);

    const del = await adminDel(app, agent_id);
    expect(del.status).toBe(200);
    expect((await del.json()).status).toBe("revoked");

    // Same key, same request — must fail closed NOW, not in 60s.
    const dead = await me(app, api_key);
    expect(dead.status).toBe(401);
    expect((await dead.json()).code).toBe("agent_key_revoked");
  });

  it("admin revoke: 401 without key, 404 unknown agent, idempotent re-revoke", async () => {
    const { app } = makeApp();
    const r = await reg(app, "victim", ipOf(6));
    const { agent_id } = await r.json();

    expect((await adminDel(app, agent_id, "wrong-key")).status).toBe(401);
    expect(
      (await adminDel(app, "eip155:5042:0xdead:999")).status,
    ).toBe(404);

    expect((await adminDel(app, agent_id)).status).toBe(200);
    // Second revoke — already revoked, still 200 (idempotent).
    expect((await adminDel(app, agent_id)).status).toBe(200);
  });
});

/* ------------------- sponsored registration (SLICE-184-5) ------------------- */

import { privateKeyToAccount } from "viem/accounts";
import { buildRegisterIntent } from "../../src/server/lib/agent-registration/intent";

const E2E_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const E2E_ACCOUNT = privateKeyToAccount(E2E_KEY);
const E2E_OWNER = E2E_ACCOUNT.address;

let sponSeq = 0n;
const okSponsored: SponsoredMintFn = async (_uri, _owner) => ({
  agentId: 900n + ++sponSeq,
  txHash: `0xsponmint${sponSeq.toString(16).padStart(4, "0")}` as `0x${string}`,
  ownerTxHash: `0xsponxfer${sponSeq.toString(16).padStart(4, "0")}` as `0x${string}`,
});

const signE2E = (name: string) =>
  E2E_ACCOUNT.signMessage({
    message: buildRegisterIntent(CHAIN_ID, REGISTRY, E2E_OWNER, name),
  });

const regSponsored = (
  app: Hono,
  name: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) =>
  app.request("/api/v1/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      name,
      owner: E2E_OWNER,
      ...extra,
    }),
  });

describe("sponsored registration e2e (SLICE-184-5)", () => {
  it("full cycle: intent-signed owner → mint+transfer; /me shows sponsored ownership", async () => {
    const { app } = makeApp({ sponsoredMint: okSponsored });
    const signature = await signE2E("gasless-agent");
    const r = await regSponsored(app, "gasless-agent", ipOf(90), { signature });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.sponsored).toBe(true);
    expect(body.owner).toBe(E2E_OWNER);
    expect(body.owner_tx).toMatch(/^0xsponxfer/);

    const me = await app.request("/api/v1/agents/me", {
      headers: { authorization: `Bearer ${body.api_key}` },
    });
    const rec = await me.json();
    expect(rec.owner).toBe(E2E_OWNER);
    expect(rec.sponsored).toBe(true);
    expect(rec.owner_tx).toBe(body.owner_tx);
  });

  it("sponsored quota exhausted → 429 sponsored_quota_exceeded; legacy path still works", async () => {
    const { app } = makeApp({
      sponsoredMint: okSponsored,
      sponsoredDailyLimit: 1,
      dailyLimit: 20,
    });
    const sig1 = await signE2E("s1");
    expect(
      (await regSponsored(app, "s1", ipOf(91), { signature: sig1 })).status,
    ).toBe(201);

    const sig2 = await signE2E("s2");
    const res = await regSponsored(app, "s2", ipOf(92), { signature: sig2 });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("sponsored_quota_exceeded");

    // Legacy (non-sponsored) registration unaffected by the sponsored budget.
    expect((await reg(app, "legacy", ipOf(93))).status).toBe(201);
  });

  it("sponsored off: owner+signature → 400, legacy register unaffected", async () => {
    const { app } = makeApp(); // no sponsoredMint
    const signature = await signE2E("nope");
    const res = await regSponsored(app, "nope", ipOf(94), { signature });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not enabled");
    expect((await reg(app, "plain", ipOf(95))).status).toBe(201);
  });

  it("missing/mismatched signature → 400, nothing minted", async () => {
    const { app, store } = makeApp({ sponsoredMint: okSponsored });
    expect((await regSponsored(app, "nosig", ipOf(96))).status).toBe(400);
    const wrong = await signE2E("other-name");
    expect(
      (await regSponsored(app, "nosig", ipOf(97), { signature: wrong })).status,
    ).toBe(400);
    expect((await store.list()).filter((r) => r.sponsored)).toEqual([]);
  });
});
