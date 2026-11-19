/**
 * SLICE-227-3 (MYPROJ-2900): settlement REST routes — sig-auth, authz,
 * idempotency dedupe, admin no-store regression (A4), code↔status class,
 * auditRecorded on post-effect writes, AdminAction on admin writes only.
 *
 * The app mounts the real route modules over an in-memory Database;
 * domain seeding (submit/approve) goes through lib/settlement services
 * — those lifecycle endpoints are commerce-wired in 227-5, not REST.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  createSettlementCtx,
  raiseDispute,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import { listAdminActions } from "../../src/server/lib/finops/index.js";
import { createSettlementReceiptSigner } from "../../src/server/lib/settlement/index.js";
import { createSettlementReceiptRoutes } from "../../src/server/routes/settlement/settlement-receipts";
import { createSettlementRoutes } from "../../src/server/routes/settlement/settlement";
import { createSettlementAdminRoutes } from "../../src/server/routes/settlement/settlement-admin";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { cacheHeadersMiddleware } from "../../src/server/middleware/cache-headers";

const BUYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_KEY =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const STRANGER_KEY =
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const provider = privateKeyToAccount(PROVIDER_KEY);
const stranger = privateKeyToAccount(STRANGER_KEY);
const ADMIN_KEY = "test-settlement-admin-key";
const OPS = "ops-route-1";
const TX = `0x${"c".repeat(64)}`;

let db: Database;
let app: Hono;

beforeEach(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  db = createDatabase({ enabled: false });
  app = new Hono();
  app.use(cacheHeadersMiddleware());
  app.route("/", createSettlementRoutes({ getDb: () => db }));
  app.route("/", createSettlementReceiptRoutes({ getDb: () => db }));
  app.route("/", createSettlementAdminRoutes({ getDb: () => db }));
});

afterEach(() => {
  delete process.env.ADMIN_API_KEY;
});

type Account = ReturnType<typeof privateKeyToAccount>;

async function sigHeaders(
  account: Account,
  method: string,
  path: string,
  rawBody: string,
  idemKey?: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = buildCommerceChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: rawBody ? createHash("sha256").update(rawBody).digest("hex") : "-",
    idemKey: idemKey ?? "-",
  });
  return {
    "x-wallet": account.address,
    "x-sig": await account.signMessage({ message }),
    "x-timestamp": String(timestamp),
    "x-nonce": nonce,
    "content-type": "application/json",
    ...(idemKey ? { idempotency_key: idemKey } : {}),
  };
}

async function req(
  method: string,
  path: string,
  opts: {
    account?: Account;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: boolean;
  } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.account) {
    Object.assign(
      headers,
      await sigHeaders(opts.account, method, path, rawBody, headers["idempotency_key"]),
    );
  }
  if (rawBody && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: rawBody || undefined,
    }),
  );
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: (await res.json()) as any,
  };
}

const adminReq = (method: string, path: string, body?: unknown, key = ADMIN_KEY) =>
  req(method, path, { body, headers: { "x-admin-key": key } });

const PLAN_BODY = (agreementRef: string) => ({
  agreementRef,
  buyerWallet: buyer.address,
  providerWallet: provider.address,
  totalUsd: "10.00",
  milestones: [{ milestoneId: "m1", title: "phase", amountUsd: "10.00" }],
});

/** Seed: plan (route) → submit+approve (domain) → OPEN intent. */
async function seedApprovedIntent() {
  const agreementRef = `agr-${randomUUID()}`;
  const ctx = createSettlementCtx(db);
  const plan = await createPlan(
    ctx,
    { ...PLAN_BODY(agreementRef) },
    buyer.address,
  );
  if (!plan.ok) throw new Error("plan seed failed");
  const m = plan.value.milestones[0]!;
  await submitForReview(
    ctx,
    { milestoneRowId: m.id, submissionRef: "ipfs://w" },
    provider.address,
  );
  const ap = await approveMilestone(ctx, m.id, buyer.address);
  if (!ap.ok) throw new Error("approve seed failed");
  return { plan: plan.value.plan, milestone: m, intentId: ap.value.intentId };
}

// ---------- public routes ----------

describe("public routes", () => {
  it("POST /api/settlement/plans without signature → 401", async () => {
    const r = await req("POST", "/api/settlement/plans", {
      body: PLAN_BODY("agr-x"),
    });
    expect(r.status).toBe(401);
    expect(r.body.code ?? r.body.error?.code).toBeTruthy();
  });

  it("POST plan by a non-participant wallet → 403 FORBIDDEN", async () => {
    const r = await req("POST", "/api/settlement/plans", {
      account: stranger,
      body: PLAN_BODY("agr-stranger"),
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("POST plan happy → 201; idem replay → 200 duplicate", async () => {
    const body = PLAN_BODY("agr-idem");
    const first = await req("POST", "/api/settlement/plans", {
      account: buyer,
      body,
    });
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    // Same logical write with an idem key + fresh signature → dedupe.
    const second = await req("POST", "/api/settlement/plans", {
      account: buyer,
      body,
      headers: { idempotency_key: "plan-create-key-1" },
    });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.plan.id).toBe(first.body.plan.id);
  });

  it("GET agreement: unsigned → 401, stranger → 404, buyer → 200", async () => {
    const body = PLAN_BODY("agr-view");
    await req("POST", "/api/settlement/plans", { account: buyer, body });
    const anon = await req("GET", "/api/settlement/agreements/agr-view");
    expect(anon.status).toBe(401);
    const out = await req("GET", "/api/settlement/agreements/agr-view", {
      account: stranger,
    });
    expect(out.status).toBe(404);
    expect(out.body.code ?? out.body.error?.code).toBeTruthy();
    const mine = await req("GET", "/api/settlement/agreements/agr-view", {
      account: provider,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.plan.agreementRef).toBe("agr-view");
    expect(mine.body.milestones).toHaveLength(1);
  });

  it("POST dispute by stranger → 403; participant → OPEN; replay → duplicate", async () => {
    const { milestone } = await seedApprovedIntent();
    const denied = await req(
      "POST",
      `/api/settlement/milestones/${milestone.id}/dispute`,
      { account: stranger, body: { reason: "not mine" } },
    );
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    const raised = await req(
      "POST",
      `/api/settlement/milestones/${milestone.id}/dispute`,
      { account: buyer, body: { reason: "work mismatch", evidenceRefs: ["ipfs://ev"] } },
    );
    expect(raised.status).toBe(200);
    expect(raised.body.dispute.status).toBe("OPEN");
    const again = await req(
      "POST",
      `/api/settlement/milestones/${milestone.id}/dispute`,
      { account: provider, body: { reason: "me too" } },
    );
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.dispute.id).toBe(raised.body.dispute.id);
  });

  it("GET receipt: unsigned → 401; buyer → 200 projection", async () => {
    const { plan } = await seedApprovedIntent();
    const anon = await req(
      "GET",
      `/api/settlement/receipts/${plan.agreementRef}`,
    );
    expect(anon.status).toBe(401);
    const r = await req("GET", `/api/settlement/receipts/${plan.agreementRef}`, {
      account: buyer,
    });
    expect(r.status).toBe(200);
    expect(r.body.type).toBe("settlement_projection@1");
    expect(r.body.milestones[0].intent.status).toBe("OPEN");
    expect(r.body.anchor).toBeNull();
  });
});

// ---------- admin routes ----------

describe("admin routes", () => {
  it("mark-paid without admin key → 401 UNAUTHORIZED + no-store", async () => {
    const { intentId } = await seedApprovedIntent();
    const res = await app.fetch(
      new Request(`http://localhost/admin/settlement/intents/${intentId}/mark-paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator: OPS, txHash: TX }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { code?: string; error?: { code?: string } };
    expect(body.code ?? body.error?.code).toBe("UNAUTHORIZED");
  });

  it("mark-paid without operator → 400 OPERATOR_REQUIRED, no AdminAction", async () => {
    const { intentId } = await seedApprovedIntent();
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { txHash: TX },
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("OPERATOR_REQUIRED");
    expect((await listAdminActions(db)).length).toBe(before);
  });

  it("mark-paid on a missing intent → 404, no AdminAction written", async () => {
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      "/admin/settlement/intents/pi_missing/mark-paid",
      { operator: OPS, txHash: TX },
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect((await listAdminActions(db)).length).toBe(before);
  });

  it("mark-paid happy → 200 auditRecorded:true + AdminAction row", async () => {
    const { intentId } = await seedApprovedIntent();
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX },
    );
    expect(r.status).toBe(200);
    expect(r.body.auditRecorded).toBe(true);
    expect(r.body.leg.txHash).toBe(TX);
    expect(r.body.intent.status).toBe("COMPLETED");
    const actions = await listAdminActions(db);
    expect(actions.length).toBe(before + 1);
    expect(actions.at(-1)?.action).toBe("MARK_PAYOUT_PAID");
    expect(actions.at(-1)?.operator).toBe(OPS);
    // Replay → 409 INVALID_STATE (code matches status class).
    const replay = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX },
    );
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("INVALID_STATE");
  });

  it("dispute resolve happy → 200 auditRecorded:true", async () => {
    const { plan } = await seedApprovedIntent();
    const ctx = createSettlementCtx(db);
    const d = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: buyer.address,
      reason: "ops review",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await adminReq(
      "POST",
      `/admin/settlement/disputes/${d.value.dispute.id}/resolve`,
      { operator: OPS, resolution: "FOR_PROVIDER" },
    );
    expect(r.status).toBe(200);
    expect(r.body.auditRecorded).toBe(true);
    const actions = await listAdminActions(db);
    expect(actions.at(-1)?.action).toBe("RESOLVE_SETTLEMENT_DISPUTE");
  });
});

// ---------- SLICE-227-4: receipt artifact + anchor ----------

describe("receipt artifact + anchor", () => {
  const signerKey =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil
  const CHAIN_ID = 5042002;

  function appWithDeps(anchorSend?: import("../../src/server/lib/eaas/anchor").SendAnchorFn) {
    const a = new Hono();
    a.use(cacheHeadersMiddleware());
    const signer = createSettlementReceiptSigner(signerKey, CHAIN_ID);
    a.route("/", createSettlementRoutes({ getDb: () => db }));
    a.route(
      "/",
      createSettlementReceiptRoutes({
        getDb: () => db,
        signer,
        chainId: CHAIN_ID,
        anchorSend,
        memo: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
        selfAddress: signer.address as `0x${string}`,
      }),
    );
    return a;
  }

  it("GET receipt carries the signed artifact once a leg completes", async () => {
    const { plan, intentId } = await seedApprovedIntent();
    await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX },
    );
    const a = appWithDeps();
    const res = await a.fetch(
      new Request(`http://localhost/api/settlement/receipts/${plan.agreementRef}`, {
        headers: await sigHeaders(buyer, "GET", `/api/settlement/receipts/${plan.agreementRef}`, ""),
      }),
    );
    const text = await res.text();
    if (res.status !== 200) console.log("RESP", res.status, text.slice(0, 400));
    const body = JSON.parse(text);
    expect(res.status).toBe(200);
    expect(body.artifact.schema).toBe("agentbadge/settlement-receipt@1");
    expect(body.artifact.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(body.artifact.milestones[0].legs[0].txHash).toBe(TX);
  });

  it("POST anchor: unsigned → 401; non-terminal → 409; released → PENDING → drain → ANCHORED", async () => {
    const { plan, intentId } = await seedApprovedIntent();
    const MEMO_TX = `0x${"f".repeat(64)}` as const;
    const sends: { to: string; data: string }[] = [];
    const a = appWithDeps(async (tx) => {
      sends.push(tx);
      return { txHash: MEMO_TX, blockNumber: 9n };
    });
    const path = `/api/settlement/receipts/${plan.agreementRef}/anchor`;
    // unsigned → 401
    const anon = await a.fetch(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    expect(anon.status).toBe(401);
    // non-terminal (milestone still APPROVED, unpaid) → 409
    const early = await a.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: await sigHeaders(buyer, "POST", path, ""),
      }),
    );
    expect(early.status).toBe(409);
    // settle → then anchor
    await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX },
    );
    // m2 must also be terminal for a two-milestone plan — seed used 1 milestone
    const ok1 = await a.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: await sigHeaders(buyer, "POST", path, ""),
      }),
    );
    expect(ok1.status).toBe(200);
    const b1 = await ok1.json();
    expect(b1.anchor.status).toBe("PENDING");
    expect(b1.duplicate).toBe(false);
    // fire-and-forget drain may lag — poll the row
    for (let i = 0; i < 50; i++) {
      const row = await db.settlement.anchors.getByReceiptRef(plan.agreementRef);
      if (row?.status === "ANCHORED") break;
      await new Promise((r2) => setTimeout(r2, 10));
    }
    const row = await db.settlement.anchors.getByReceiptRef(plan.agreementRef);
    expect(row?.status).toBe("ANCHORED");
    expect(row?.txHash).toBe(MEMO_TX);
    // duplicate request → same row
    const dup = await a.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: await sigHeaders(provider, "POST", path, ""),
      }),
    );
    const b2 = await dup.json();
    expect(b2.duplicate).toBe(true);
    expect(b2.anchor.status).toBe("ANCHORED");
    expect(sends.length).toBe(1);
    // admin path also reaches the anchor (idempotent → duplicate)
    const admin = await a.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(admin.status).toBe(200);
    expect((await admin.json()).duplicate).toBe(true);
  });
});
