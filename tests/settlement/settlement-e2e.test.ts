/**
 * SLICE-227-6 (MYPROJ-2891): full settlement e2e + contract guards.
 *
 * Journey: plan with a leg template (provider + PLATFORM_FEE) →
 * submit → approve → intent OPEN → admin mark-paid every leg with a
 * real-format txHash → intent COMPLETED → milestone RELEASED → plan
 * COMPLETED → receipt artifact → anchor PENDING → drained ANCHORED.
 *
 * Guard surface (review-1911 §3.2/§3.4):
 * - audit store forced to throw post-effect → `auditRecorded:false`,
 *   effect still landed (leg COMPLETED), response does not lie.
 * - txHash contract: invalid format → 400; verifyTx adapter returns
 *   non-verified → typed fail-closed, no effect; txHash replay across
 *   (network, hash) → 409; requireVerification without adapter → 503.
 * - dispute raise → legs/intent FROZEN → resolve SPLIT → legs replaced.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  createSettlementCtx,
  createSettlementReceiptSigner,
  raiseDispute,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type { PayoutTxCheck } from "../../src/server/lib/settlement/verify-payout-tx.js";
import { listAdminActions } from "../../src/server/lib/finops/index.js";
import { drainSettlementAnchors } from "../../src/server/lib/settlement/services/anchor.js";
import { createSettlementReceiptRoutes } from "../../src/server/routes/settlement/settlement-receipts";
import { createSettlementAdminRoutes } from "../../src/server/routes/settlement/settlement-admin";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { cacheHeadersMiddleware } from "../../src/server/middleware/cache-headers";

const BUYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_KEY =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const STRANGER_KEY =
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture
const SIGNER_KEY =
  "0x4bbbf85ce3377467afe5d46f30f0edc6d98e0fb9d4d14cb8aefc2ff952c5f24f"; // secret-scan:allow: anvil test fixture
const FEE_WALLET = "0x1111111111111111111111111111111111111111";

const buyer = privateKeyToAccount(BUYER_KEY);
const provider = privateKeyToAccount(PROVIDER_KEY);
const stranger = privateKeyToAccount(STRANGER_KEY);
const CHAIN_ID = 421614;
const signer = createSettlementReceiptSigner(SIGNER_KEY, CHAIN_ID);
const ADMIN_KEY = "test-e2e-admin";
const OPS = "ops-e2e";
const RUN = randomUUID().slice(0, 8);
const TX_A = `0x${"a".repeat(63)}${RUN.slice(0, 1)}`;
const TX_B = `0x${"b".repeat(64)}`;

let db: Database;
let app: Hono;
let anchorSends: { to: string; memo: string }[];

type Deps = Parameters<typeof createSettlementAdminRoutes>[0];

function makeApp(admin: Partial<Deps> = {}) {
  app = new Hono();
  app.use(cacheHeadersMiddleware());
  app.route(
    "/",
    createSettlementReceiptRoutes({
      getDb: () => db,
      signer,
      chainId: CHAIN_ID,
      memo: "0x1111111111111111111111111111111111111111",
      selfAddress: "0x2222222222222222222222222222222222222222",
      anchorSend: async (tx: { to: `0x${string}`; data: Hex }) => {
        anchorSends.push({ to: tx.to, memo: tx.data });
        return { txHash: `0x${"f".repeat(64)}` as Hex, blockNumber: 1n };
      },
    }),
  );
  app.route("/", createSettlementAdminRoutes({ getDb: () => db, ...admin }));
}

beforeEach(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  db = createDatabase({ enabled: false });
  anchorSends = [];
  makeApp();
});

afterEach(() => {
  delete process.env.ADMIN_API_KEY;
});

type Account = ReturnType<typeof privateKeyToAccount>;

async function req(
  method: string,
  path: string,
  opts: { account?: Account; body?: unknown; headers?: Record<string, string> } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.account) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const message = buildCommerceChallenge({
      wallet: opts.account.address,
      method,
      path,
      timestamp,
      nonce,
      bodyHash: rawBody ? createHash("sha256").update(rawBody).digest("hex") : "-",
      idemKey: "-",
    });
    Object.assign(headers, {
      "x-wallet": opts.account.address,
      "x-sig": await opts.account.signMessage({ message }),
      "x-timestamp": String(timestamp),
      "x-nonce": nonce,
      "content-type": "application/json",
    });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as any };
}

const adminReq = (method: string, path: string, body?: unknown) =>
  req(method, path, { body, headers: { "x-admin-key": ADMIN_KEY } });

/** Seed: plan with provider+fee leg template → submit → approve → OPEN intent. */
async function seedIntent() {
  const agreementRef = `agr-${randomUUID()}`;
  const ctx = createSettlementCtx(db);
  const plan = await createPlan(
    ctx,
    {
      agreementRef,
      buyerWallet: buyer.address,
      providerWallet: provider.address,
      totalUsd: "10.00",
      milestones: [
        {
          milestoneId: "m1",
          title: "deliverable",
          amountUsd: "10.00",
          legs: [
            { payee: provider.address, amountUsdc: "9.00", role: "PROVIDER" },
            { payee: FEE_WALLET, amountUsdc: "1.00", role: "PLATFORM_FEE" },
          ],
        },
      ],
    },
    buyer.address,
  );
  if (!plan.ok) throw new Error(`plan: ${JSON.stringify(plan.error)}`);
  const m = plan.value.milestones[0]!;
  await submitForReview(
    ctx,
    { milestoneRowId: m.id, submissionRef: "ipfs://e2e" },
    provider.address,
  );
  const ap = await approveMilestone(ctx, m.id, buyer.address);
  if (!ap.ok) throw new Error("approve failed");
  return { plan: plan.value.plan, milestone: m, intentId: ap.value.intentId };
}

const legsOf = (intentId: string) =>
  db.settlement.payoutLegs.listByIntent(intentId);

// ---------- full journey ----------

describe("e2e: plan → paid legs → released → receipt → anchor", () => {
  it("runs the full lifecycle end to end", async () => {
    const { plan, intentId } = await seedIntent();

    // Intent OPEN with the two template legs.
    const legs = await legsOf(intentId);
    expect(legs.map((l) => l.role).sort()).toEqual([
      "PLATFORM_FEE",
      "PROVIDER",
    ]);

    // Admin marks each leg paid with a real-format txHash.
    const p1 = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX_A, legId: legs[0]!.id },
    );
    expect(p1.status).toBe(200);
    expect(p1.body.auditRecorded).toBe(true);
    const p2 = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX_B, legId: legs[1]!.id },
    );
    expect(p2.status).toBe(200);
    expect(p2.body.intent.status).toBe("COMPLETED");
    expect(p2.body.milestone.status).toBe("RELEASED");

    // Plan rolled up COMPLETED; AdminActions landed.
    expect((await db.settlement.plans.getById(plan.id))!.status).toBe(
      "COMPLETED",
    );
    const actions = await listAdminActions(db, {
      subjectType: "payout_leg",
    });
    expect(actions.length).toBeGreaterThanOrEqual(2);

    // Receipt carries the artifact once legs are completed.
    const rec = await req(
      "GET",
      `/api/settlement/receipts/${plan.agreementRef}`,
      { account: provider },
    );
    expect(rec.status).toBe(200);
    expect(rec.body.artifact).toBeTruthy();
    expect(rec.body.artifact.body.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Anchor: PENDING row → drained → ANCHORED.
    const anchor = await req(
      "POST",
      `/api/settlement/receipts/${plan.agreementRef}/anchor`,
      { account: buyer, body: {} },
    );
    expect(anchor.status).toBe(200);
    expect(anchor.body.anchor.status).toBe("PENDING");
    // Fire-and-forget drain races the assert — drain is idempotent,
    // so calling it again converges to ANCHORED either way.
    await drainSettlementAnchors(createSettlementCtx(db), {
      send: async (tx: { to: `0x${string}`; data: Hex }) => {
        anchorSends.push({ to: tx.to, memo: tx.data });
        return { txHash: `0x${"f".repeat(64)}` as Hex, blockNumber: 1n };
      },
      memo: "0x1111111111111111111111111111111111111111",
      selfAddress: "0x2222222222222222222222222222222222222222",
    });
    const anchored = await db.settlement.anchors.getById(
      anchor.body.anchor.id,
    );
    expect(anchored?.status).toBe("ANCHORED");
    expect(anchorSends.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------- dispute → freeze → SPLIT ----------

describe("e2e: dispute freeze → resolve SPLIT", () => {
  it("freezes intent+legs, replaces legs, records AdminAction", async () => {
    const { milestone, intentId } = await seedIntent();
    const ctx = createSettlementCtx(db);
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestone.id,
      raisedBy: buyer.address,
      reason: "partial delivery",
    });
    if (!d.ok) throw new Error("dispute failed");
    expect((await legsOf(intentId)).every((l) => l.status === "FROZEN")).toBe(
      true,
    );

    const r = await adminReq(
      "POST",
      `/admin/settlement/disputes/${d.value.dispute.id}/resolve`,
      {
        operator: OPS,
        resolution: "SPLIT",
        splitLegs: [
          { payee: provider.address, amountUsdc: "6.00", role: "PROVIDER" },
          { payee: buyer.address, amountUsdc: "4.00", role: "PROVIDER" },
        ],
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.auditRecorded).toBe(true);

    const legs = (await legsOf(intentId)).filter((l) => l.status === "OPEN");
    expect(legs.map((l) => l.amountUsdc).sort()).toEqual(["4", "6"]);
    const actions = await listAdminActions(db, {
      subjectType: "settlement_dispute",
    });
    expect(
      actions.some((a) => a.action === "RESOLVE_SETTLEMENT_DISPUTE"),
    ).toBe(true);
  });
});

// ---------- guards ----------

describe("contract guards", () => {
  it("mark-paid without txHash → 400", async () => {
    const { intentId } = await seedIntent();
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS },
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).not.toBe("INTERNAL_ERROR");
  });

  it("non-participant cannot dispute → 403, no FROZEN legs", async () => {
    const { plan, intentId } = await seedIntent();
    const ctx = createSettlementCtx(db);
    const d = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: stranger.address,
      reason: "x",
    });
    expect(d.ok).toBe(false);
    expect((await legsOf(intentId))[0]!.status).toBe("OPEN");
  });

  it("audit store down post-effect → auditRecorded:false, leg COMPLETED", async () => {
    const { intentId } = await seedIntent();
    const leg = (await legsOf(intentId))[0]!;
    const orig = db.finops.adminActions.append;
    db.finops.adminActions.append = () => {
      throw new Error("audit store down");
    };
    try {
      const r = await adminReq(
        "POST",
        `/admin/settlement/intents/${intentId}/mark-paid`,
        { operator: OPS, txHash: TX_A, legId: leg.id },
      );
      expect(r.status).toBe(200);
      expect(r.body.auditRecorded).toBe(false);
    } finally {
      db.finops.adminActions.append = orig;
    }
    expect((await legsOf(intentId))[0]!.status).toBe("COMPLETED");
  });

  it("verifyTx adapter returns non-verified → typed failure, leg stays OPEN", async () => {
    makeApp({
      verifyTx: async (): Promise<PayoutTxCheck> => ({ verified: false }),
    });
    const { intentId } = await seedIntent();
    const leg = (await legsOf(intentId))[0]!;
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX_A, legId: leg.id },
    );
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await legsOf(intentId))[0]!.status).toBe("OPEN");
  });

  it("requireVerification without adapter → 503-style typed failure", async () => {
    makeApp({ requireVerification: true });
    const { intentId } = await seedIntent();
    const leg = (await legsOf(intentId))[0]!;
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX_A, legId: leg.id },
    );
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("VERIFIER_UNAVAILABLE");
  });

  it("txHash replay across legs → 409, second leg not completed", async () => {
    const { intentId } = await seedIntent();
    const legs = await legsOf(intentId);
    const r1 = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX_A, legId: legs[0]!.id },
    );
    expect(r1.status).toBe(200);
    const r2 = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: OPS, txHash: TX_A, legId: legs[1]!.id },
    );
    expect(r2.status).toBe(409);
    expect((await legsOf(intentId))[1]!.status).toBe("OPEN");
  });
});
