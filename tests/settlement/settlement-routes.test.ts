/**
 * SLICE-227-3 (MYPROJ-2900): settlement REST routes — sig-auth, authz,
 * idempotency dedupe, admin no-store regression (A4), code↔status class,
 * auditRecorded on post-effect writes, AdminAction on admin writes only.
 *
 * The app mounts the real route modules over an in-memory Database;
 * domain seeding (submit/approve) goes through lib/settlement services
 * — those lifecycle endpoints are commerce-wired in 227-5, not REST.
 * Shared setup + request helpers live in route-helpers.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Database } from "@agentbadge/database";

import { createSettlementReceiptSigner } from "../../src/server/lib/settlement/index.js";
import { createSettlementReceiptRoutes } from "../../src/server/routes/settlement/settlement-receipts";
import { createSettlementRoutes } from "../../src/server/routes/settlement/settlement";
import { cacheHeadersMiddleware } from "../../src/server/middleware/cache-headers";

import {
  ADMIN_KEY,
  adminReq,
  buyer,
  initRouteTest,
  OPS,
  PLAN_BODY,
  provider,
  req,
  rt,
  seedApprovedIntent,
  sigHeaders,
  stranger,
  teardownRouteTest,
  TX,
} from "./route-helpers.js";

let db: Database;
beforeEach(() => {
  initRouteTest();
  db = rt.db;
});
afterEach(teardownRouteTest);

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

  it("prod-verify DELTA-MEDIUM: participant-scoped /api/settlement/* → no-store on 200 AND 401/404", async () => {
    const body = PLAN_BODY("agr-cache");
    await req("POST", "/api/settlement/plans", { account: buyer, body });
    // 200 participant view — no shared-cache copy of scoped data.
    const mine = await req("GET", "/api/settlement/agreements/agr-cache", {
      account: provider,
    });
    expect(mine.status).toBe(200);
    expect(mine.cacheControl).toBe("no-store");
    // Refusals too — a cached 401/404 IS the existence oracle.
    const anon = await req("GET", "/api/settlement/agreements/agr-cache");
    expect(anon.status).toBe(401);
    expect(anon.cacheControl).toBe("no-store");
    const out = await req("GET", "/api/settlement/agreements/agr-cache", {
      account: stranger,
    });
    expect(out.status).toBe(404);
    expect(out.cacheControl).toBe("no-store");
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
