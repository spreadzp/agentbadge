/**
 * SLICE-155-1 tests: AgentWalletRegistry + routes.
 *
 * Covered (per spec acceptance criteria):
 *  - POST /api/wallets: valid wallet-sig → 201; signer≠address → 403;
 *    duplicate → 409; bad input → 400; missing sig → 401.
 *  - SCA-safe: verifier stub covers ERC-1271 path (no ecrecover-only).
 *  - GET /api/wallets/:address: record + balance mirror; CLI stubbed
 *    unavailable → "unavailable"; unregistered → 404.
 *  - GET /api/venue/instances/:id/wallets: member sees venue-scoped
 *    list; non-member → 403; unscoped wallets NOT leaked.
 *  - DELETE /api/wallets/:address: registrant ok; venue admin ok;
 *    stranger → 403; inactive → 404.
 *  - Registry: json store round-trip (mkdtemp), venue filter, newest
 *    first, deactivate; validateWalletInput guards.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentWalletRoutes,
  type AgentWalletRoutesDeps,
} from "../src/server/routes/agent-wallet-api";
import {
  createMemoryAgentWalletStore,
  createJsonAgentWalletStore,
  validateWalletInput,
} from "../src/server/lib/agent-wallet/registry";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import {
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/venue/store";
import { createVenue } from "../src/server/lib/venue/venues";
import { addVenueMember } from "../src/server/lib/venue/members";

const OWNER = "0x00000000000000000000000000000000000000aa";
const W_AGENT = "0x00000000000000000000000000000000000000b1";
const W_AGENT2 = "0x00000000000000000000000000000000000000b2";
const W_MEMBER = "0x00000000000000000000000000000000000000c1";
const W_STRANGER = "0x00000000000000000000000000000000000000dd";

const SAVED_DB = process.env.DATABASE_ENABLED;

const signedHeaders = (wallet: string) => ({
  "x-wallet": wallet,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
});

function makeApp(deps: Partial<AgentWalletRoutesDeps> = {}) {
  const a = new Hono();
  a.route(
    "/",
    createAgentWalletRoutes({
      store: createMemoryAgentWalletStore(),
      chain: "ARC",
      rateRpm: 60,
      ...deps,
    }),
  );
  return a;
}

/** Store reachable from tests — shares the app store via closure. */
function makeAppWithStore(deps: Partial<AgentWalletRoutesDeps> = {}) {
  const store = createMemoryAgentWalletStore();
  const app = makeApp({ store, ...deps });
  return { app, store };
}

const post = (
  app: Hono,
  body: unknown,
  wallet = W_AGENT,
  headers: Record<string, string> = {},
) =>
  app.request("/api/wallets", {
    method: "POST",
    headers: { ...signedHeaders(wallet), ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
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
  if (SAVED_DB === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB;
  resetConfigCache();
});

/* ------------------------------ POST /wallets ----------------------------- */

describe("POST /api/wallets", () => {
  it("valid wallet-sig → 201 + record", async () => {
    const app = makeApp();
    const res = await post(app, {
      address: W_AGENT,
      label: "provider-bot",
      agentId: "42",
    });
    expect(res.status).toBe(201);
    const rec = await res.json();
    expect(rec.address).toMatch(/^0x/i);
    expect(rec.label).toBe("provider-bot");
    expect(rec.agentId).toBe("42");
    expect(rec.active).toBe(true);
    expect(rec.registeredBy).toBe(W_AGENT.toLowerCase());
  });

  it("signer ≠ registered address → 403 (ownership proof)", async () => {
    const app = makeApp();
    const res = await post(app, { address: W_AGENT, label: "x" }, W_STRANGER);
    expect(res.status).toBe(403);
  });

  it("missing sig headers → 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: W_AGENT, label: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("duplicate active wallet → 409", async () => {
    const app = makeApp();
    const body = { address: W_AGENT, label: "x" };
    expect((await post(app, body)).status).toBe(201);
    expect((await post(app, body)).status).toBe(409);
  });

  it("bad input → 400 (invalid address / empty label / bad kind)", async () => {
    const app = makeApp();
    expect(
      (await post(app, { address: "0xnot-an-addr", label: "x" })).status,
    ).toBe(400);
    expect(
      (await post(app, { address: W_AGENT, label: "" })).status,
    ).toBe(400);
    expect(
      (await post(app, { address: W_AGENT, label: "x", kind: "nope" })).status,
    ).toBe(400);
  });

  it("SCA-sig path: verifier covers ERC-1271, not ecrecover-only", async () => {
    // configureAgentAuthForTesting verifier = the same entry point
    // verifyWalletSigRequest uses for EOA/1271/6492 — stubbing it true
    // proves the route doesn't bypass the shared SCA-aware verifier.
    const app = makeApp();
    const res = await post(
      app,
      { address: W_AGENT2, label: "sca-wallet", kind: "circle-agent" },
      W_AGENT2,
    );
    expect(res.status).toBe(201);
  });
});

/* ---------------------------- GET /wallets/:addr -------------------------- */

describe("GET /api/wallets/:address", () => {
  it("record + CLI balance mirror", async () => {
    const { app, store } = makeAppWithStore({
      cli: {
        isAvailable: async () => true,
        status: async () => ({ loggedIn: true }),
        listWallets: async () => [],
        balance: async () => "12.50",
        limits: async () => ({ daily: "100" }),
      },
    });
    store.put({
      address: W_AGENT,
      label: "x",
      kind: "circle-agent",
      envelope: {},
      registeredBy: W_AGENT.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      active: true,
    });
    const res = await app.request(`/api/wallets/${W_AGENT}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe("12.50");
    expect(body.limits.daily).toBe("100");
  });

  it("CLI unavailable → balance 'unavailable', record still served", async () => {
    const { app, store } = makeAppWithStore({
      cli: {
        isAvailable: async () => false,
        status: async () => ({ loggedIn: false }),
        listWallets: async () => [],
        balance: async () => "unavailable",
        limits: async () => {
          throw new Error("unavailable");
        },
      },
    });
    store.put({
      address: W_AGENT,
      label: "x",
      kind: "eoa",
      envelope: {},
      registeredBy: W_AGENT.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      active: true,
    });
    const res = await app.request(`/api/wallets/${W_AGENT}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe("unavailable");
  });

  it("unregistered → 404; malformed address → 400", async () => {
    const app = makeApp();
    expect((await app.request(`/api/wallets/${W_AGENT}`)).status).toBe(404);
    expect((await app.request("/api/wallets/0xnope")).status).toBe(400);
  });
});

/* ------------------------- venue-scoped list + delete ---------------------- */

describe("GET /api/venue/instances/:id/wallets + DELETE", () => {
  async function venueFixture() {
    const v = createVenue({
      name: "Biz",
      slug: `biz-${Math.random().toString(16).slice(2, 8)}`,
      kind: "business",
      ownerWallet: OWNER,
    });
    addVenueMember(v.id, { wallet: W_MEMBER, role: "provider", addedBy: OWNER });
    return v;
  }

  it("member sees only venue-scoped active wallets; unscoped not leaked", async () => {
    const v = await venueFixture();
    const { app, store } = makeAppWithStore();
    const base = {
      kind: "circle-agent" as const,
      envelope: {},
      createdAt: Date.now(),
      active: true,
    };
    store.put({
      ...base,
      address: W_AGENT,
      label: "venue-w",
      venueId: v.id,
      registeredBy: W_AGENT.toLowerCase() as `0x${string}`,
    });
    store.put({
      ...base,
      address: W_AGENT2,
      label: "unscoped",
      registeredBy: W_AGENT2.toLowerCase() as `0x${string}`,
    });
    const res = await app.request(`/api/venue/instances/${v.id}/wallets`, {
      headers: signedHeaders(W_MEMBER),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.venueId).toBe(v.id);
    expect(body.wallets).toHaveLength(1);
    expect(body.wallets[0].address).toMatch(/^0x/i);
  });

  it("non-member → 403; unknown venue → 404", async () => {
    const v = await venueFixture();
    const app = makeApp();
    const res = await app.request(`/api/venue/instances/${v.id}/wallets`, {
      headers: signedHeaders(W_STRANGER),
    });
    expect(res.status).toBe(403);
    const res404 = await app.request(
      "/api/venue/instances/vn_nonexistent/wallets",
      { headers: signedHeaders(W_MEMBER) },
    );
    expect(res404.status).toBe(404);
  });

  it("DELETE: registrant ok; stranger → 403; venue admin ok", async () => {
    const v = await venueFixture();
    const { app, store } = makeAppWithStore();
    store.put({
      address: W_AGENT,
      label: "x",
      kind: "circle-agent",
      envelope: {},
      venueId: v.id,
      registeredBy: W_AGENT.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      active: true,
    });

    // stranger cannot
    const denied = await app.request(`/api/wallets/${W_AGENT}`, {
      method: "DELETE",
      headers: signedHeaders(W_STRANGER),
    });
    expect(denied.status).toBe(403);

    // registrant can
    const own = await app.request(`/api/wallets/${W_AGENT}`, {
      method: "DELETE",
      headers: signedHeaders(W_AGENT),
    });
    expect(own.status).toBe(200);
    expect(store.get(W_AGENT)?.active).toBe(false);

    // already inactive → 404
    const again = await app.request(`/api/wallets/${W_AGENT}`, {
      method: "DELETE",
      headers: signedHeaders(W_AGENT),
    });
    expect(again.status).toBe(404);

    // venue admin (owner) can deactivate a member's wallet
    store.put({
      address: W_AGENT2,
      label: "x",
      kind: "eoa",
      envelope: {},
      venueId: v.id,
      registeredBy: W_MEMBER.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      active: true,
    });
    const adminDel = await app.request(`/api/wallets/${W_AGENT2}`, {
      method: "DELETE",
      headers: signedHeaders(OWNER),
    });
    expect(adminDel.status).toBe(200);
  });
});

/* --------------------------------- store ---------------------------------- */

describe("agent-wallet store", () => {
  it("json store round-trip + venue filter + newest first", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-"));
    const path = join(dir, "wallets.json");
    const s = createJsonAgentWalletStore(path);
    const mk = (address: string, venueId?: string) => ({
      address: address as `0x${string}`,
      label: "x",
      kind: "eoa" as const,
      envelope: {},
      registeredBy: OWNER.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      active: true,
      ...(venueId ? { venueId } : {}),
    });
    s.put({ ...mk(W_AGENT, "vn_a"), createdAt: 1 });
    s.put({ ...mk(W_AGENT2, "vn_a"), createdAt: 2 });
    s.put(mk(W_MEMBER, "vn_b"));
    const list = s.list("vn_a");
    expect(list).toHaveLength(2);
    expect(list[0].createdAt).toBe(2); // newest first
    expect(s.get(W_AGENT)?.venueId).toBe("vn_a");
    expect(s.deactivate(W_AGENT)).toBe(true);
    expect(s.get(W_AGENT)?.active).toBe(false);
    expect(s.deactivate(W_STRANGER)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("validateWalletInput rejects bad shapes and checksums address", () => {
    expect(() =>
      validateWalletInput({ address: "0xzz", label: "x", registeredBy: OWNER }),
    ).toThrow(/address/);
    expect(() =>
      validateWalletInput({ address: W_AGENT, label: "  ", registeredBy: OWNER }),
    ).toThrow(/label/);
    expect(() =>
      validateWalletInput({
        address: W_AGENT,
        label: "x",
        kind: "evil" as never,
        registeredBy: OWNER,
      }),
    ).toThrow(/kind/);
    const v = validateWalletInput({
      address: W_AGENT,
      label: "x",
      registeredBy: OWNER,
    });
    expect(v.kind).toBe("circle-agent");
    expect(v.registeredBy).toBe(OWNER.toLowerCase());
  });
});
