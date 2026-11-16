/**
 * SLICE-225-3 (EPIC-225): identity REST routes — public reads,
 * owner enrich (EIP-191), admin revoke, guard/error paths.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { randomUUID, createHash } from "node:crypto";
import { createInMemoryIdentityStores } from "@agentbadge/database";

import { createIdentityService } from "../src/server/lib/identity/index.js";
import { createIdentityRoutes } from "../src/server/routes/identity-api.js";
import { buildCommerceChallenge } from "../src/server/routes/commerce/shared";

const OWNER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // secret-scan:allow: anvil test fixture
const STRANGER_KEY =
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture

const owner = privateKeyToAccount(OWNER_KEY);
const stranger = privateKeyToAccount(STRANGER_KEY);

const ADMIN_KEY = "test-admin-key-2253"; // secret-scan:allow: test fixture

let app: Hono;
let service: ReturnType<typeof createIdentityService>;

beforeEach(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  service = createIdentityService({
    identity: createInMemoryIdentityStores(),
  });
  app = new Hono();
  app.route("/", createIdentityRoutes(service));
});

async function sigHeaders(
  account: ReturnType<typeof privateKeyToAccount>,
  method: string,
  path: string,
  rawBody: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = buildCommerceChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: rawBody
      ? createHash("sha256").update(rawBody).digest("hex")
      : "-",
    idemKey: "-",
  });
  const signature = await account.signMessage({ message });
  return {
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
    "x-nonce": nonce,
    "content-type": "application/json",
  };
}

async function req(
  method: string,
  path: string,
  opts: {
    account?: ReturnType<typeof privateKeyToAccount>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers = { ...(opts.headers ?? {}) };
  if (opts.account) {
    Object.assign(headers, await sigHeaders(opts.account, method, path, rawBody));
  }
  return app.request(path, {
    method,
    body: rawBody || undefined,
    headers,
  });
}

// ---------- GET /api/v1/actors/:wallet ----------

describe("GET /api/v1/actors/:wallet", () => {
  it("404 for an unknown wallet", async () => {
    const res = await req("GET", `/api/v1/actors/${owner.address}`);
    expect(res.status).toBe(404);
  });

  it("200 with the actor record", async () => {
    await service.actors.resolveOrCreate(owner.address.toLowerCase(), {
      did: "did:web:x",
    });
    const res = await req("GET", `/api/v1/actors/${owner.address}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actor.wallet).toBe(owner.address.toLowerCase());
    expect(body.actor.did).toBe("did:web:x");
  });

  it("400 on a malformed wallet", async () => {
    const res = await req("GET", "/api/v1/actors/0xNOPE");
    expect(res.status).toBe(400);
  });
});

// ---------- GET /api/v1/entitlements/:wallet ----------

describe("GET /api/v1/entitlements/:wallet", () => {
  it("returns the wallet's entitlement rows", async () => {
    await service.entitlements.grant({
      ownerId: owner.address.toLowerCase(),
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const res = await req(
      "GET",
      `/api/v1/entitlements/${owner.address}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitlements).toHaveLength(1);
    expect(body.entitlements[0].productCode).toBe("PASSPORT_BRONZE");
    expect(body.entitlements[0].status).toBe("ACTIVE");
  });

  it("filters by status and productCode", async () => {
    await service.entitlements.grant({
      ownerId: owner.address.toLowerCase(),
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const res = await req(
      "GET",
      `/api/v1/entitlements/${owner.address}?status=REVOKED`,
    );
    const body = await res.json();
    expect(body.entitlements).toHaveLength(0);
  });
});

// ---------- GET /api/v1/reputation/:wallet ----------

describe("GET /api/v1/reputation/:wallet", () => {
  it("returns counts + facts with factType filter", async () => {
    await service.facts.taskCompleted(owner.address.toLowerCase(), "ag_1");
    await service.facts.dispute(owner.address.toLowerCase(), "ag_2");
    const res = await req(
      "GET",
      `/api/v1/reputation/${owner.address}?factType=TASK_COMPLETED`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.TASK_COMPLETED).toBe(1);
    expect(body.counts.DISPUTE).toBe(1);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].sourceRef).toBe("agreement:ag_1");
  });

  it("400 on an unknown factType", async () => {
    const res = await req(
      "GET",
      `/api/v1/reputation/${owner.address}?factType=NOPE`,
    );
    expect(res.status).toBe(400);
  });
});

// ---------- POST /api/v1/actors/:wallet/enrich ----------

describe("POST /api/v1/actors/:wallet/enrich", () => {
  it("401 without signature headers", async () => {
    const res = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      body: { did: "did:web:x" },
    });
    expect(res.status).toBe(401);
  });

  it("403 when the signer is not the path wallet", async () => {
    const res = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      account: stranger,
      body: { did: "did:web:x" },
    });
    expect(res.status).toBe(403);
  });

  it("200 — owner enriches own links", async () => {
    const res = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      account: owner,
      body: { did: "did:web:me" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actor.did).toBe("did:web:me");
    // H-6: payload never leaves via the public surface.
    expect(body.actor.payload).toBeUndefined();
  });

  it("400 — tier/unknown fields rejected by strict schema (H-1)", async () => {
    const res = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      account: owner,
      body: { tier: "gold" },
    });
    expect(res.status).toBe(400);
    const res2 = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      account: owner,
      body: { did: "did:web:x", sneaky: true },
    });
    expect(res2.status).toBe(400);
  });

  it("400 — passportTokenId without a passports port fails closed (C-1)", async () => {
    // service was created without the passports dep → writes of the
    // verified link must not self-mint REGISTERED_USER.
    const res = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      account: owner,
      body: { passportTokenId: "pass_1" },
    });
    expect(res.status).toBe(400);
    const actor = await service.actors.get(owner.address.toLowerCase());
    expect(actor?.type ?? null).not.toBe("REGISTERED_USER");
  });

  it("400 — malformed body is INVALID_INPUT, not a 500 (M-6)", async () => {
    const res = await req("POST", `/api/v1/actors/${owner.address}/enrich`, {
      account: owner,
      body: { type: "REGISTERED_USER" },
    });
    expect(res.status).toBe(400);
  });

  it("409 — nonce replay is rejected even with idempotency_key (H-2)", async () => {
    // Identity enrich has no store-level idem dedupe, so the nonce
    // must be fresh every request — an idem header doesn't exempt.
    const path = `/api/v1/actors/${owner.address}/enrich`;
    const rawBody = JSON.stringify({ did: "did:web:me" });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const message = buildCommerceChallenge({
      wallet: owner.address,
      method: "POST",
      path,
      timestamp,
      nonce,
      bodyHash: createHash("sha256").update(rawBody).digest("hex"),
      idemKey: "req_idem_001",
    });
    const signature = await owner.signMessage({ message });
    const headers = {
      "x-wallet": owner.address,
      "x-sig": signature,
      "x-timestamp": String(timestamp),
      "x-nonce": nonce,
      idempotency_key: "req_idem_001",
      "content-type": "application/json",
    };
    const first = await app.request(path, {
      method: "POST",
      body: rawBody,
      headers,
    });
    expect(first.status).toBe(200);
    const replay = await app.request(path, {
      method: "POST",
      body: rawBody,
      headers,
    });
    expect(replay.status).toBe(409);
  });

  it("400 — junk status/productCode filters are validated (M-6)", async () => {
    const res = await app.request(
      `/api/v1/entitlements/${owner.address}?status=HACKED`,
    );
    expect(res.status).toBe(400);
    const res2 = await app.request(
      `/api/v1/entitlements/${owner.address}?productCode=bad%20code`,
    );
    expect(res2.status).toBe(400);
  });

  it("H-6 — entitlements list strips payload/idempotencyKey/sourcePaymentId", async () => {
    await service.entitlements.grant({
      ownerId: owner.address.toLowerCase(),
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_secret",
      idempotencyKey: "route_test_key",
    });
    const res = await app.request(
      `/api/v1/entitlements/${owner.address}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitlements).toHaveLength(1);
    const row = body.entitlements[0];
    expect(row.status).toBe("ACTIVE");
    expect(row.payload).toBeUndefined();
    expect(row.idempotencyKey).toBeUndefined();
    expect(row.sourcePaymentId).toBeUndefined();
  });
});

// ---------- POST /api/v1/entitlements/:wallet/revoke ----------

describe("POST /api/v1/entitlements/:wallet/revoke", () => {
  it("401 without an admin key", async () => {
    const res = await req(
      "POST",
      `/api/v1/entitlements/${owner.address}/revoke`,
      { body: { productCode: "PASSPORT_BRONZE" } },
    );
    expect(res.status).toBe(401);
  });

  it("401 on a wrong admin key", async () => {
    const res = await req(
      "POST",
      `/api/v1/entitlements/${owner.address}/revoke`,
      {
        body: { productCode: "PASSPORT_BRONZE" },
        headers: { "X-Admin-Key": "wrong-key" },
      },
    );
    expect(res.status).toBe(401);
  });

  it("404 when no ACTIVE entitlement exists", async () => {
    const res = await req(
      "POST",
      `/api/v1/entitlements/${owner.address}/revoke`,
      {
        body: { productCode: "PASSPORT_BRONZE" },
        headers: { "X-Admin-Key": ADMIN_KEY },
      },
    );
    expect(res.status).toBe(404);
  });

  it("200 — admin revokes the ACTIVE entitlement", async () => {
    await service.entitlements.grant({
      ownerId: owner.address.toLowerCase(),
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const res = await req(
      "POST",
      `/api/v1/entitlements/${owner.address}/revoke`,
      {
        body: { productCode: "PASSPORT_BRONZE" },
        headers: { "X-Admin-Key": ADMIN_KEY },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitlement.status).toBe("REVOKED");
    // Bearer form also accepted.
    const res2 = await req(
      "POST",
      `/api/v1/entitlements/${owner.address}/revoke`,
      {
        body: { productCode: "PASSPORT_BRONZE" },
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      },
    );
    expect(res2.status).toBe(404); // already revoked — no ACTIVE left
  });
});
