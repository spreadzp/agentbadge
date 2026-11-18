/**
 * SLICE-226-4 — end-to-end ops scenarios across the whole
 * /admin/finance/* surface: one seeded in-memory Database driven
 * through HTTP — list filters → detail trace → manual actions →
 * refunds → exceptions → reports/CSV → audit trail.
 *
 * VerifyRefundTx and StripeRefundClient are injected stubs; a bare
 * app without them proves the honest-503 seam — a bare txHash is
 * never trusted (D-226-4, no fabricated confirmations).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  createDatabase,
  type Database,
  type PaymentAttemptInsert,
  type PaymentInsert,
} from "@agentbadge/database";

import { createFinopsRoutes } from "../../src/server/routes/finops/finops";

const KEY = "test-admin-key";
const auth = { "X-Admin-Key": KEY };
const PAYEE = "0x" + "a".repeat(40);
const TX1 = "0x" + "d".repeat(64);

let db: Database;
let app: Hono;
let verifyCalls: { txHash: string; payee: string }[];
let stripeCalls: string[];

const get = (path: string) => app.request(path, { headers: auth });
const post = (path: string, body?: Record<string, unknown>) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;

interface SeedOpts {
  status?: string;
  amount?: string;
  currency?: string;
  productId?: string | null;
  provider?: string;
  network?: string | null;
  providerReference?: string | null;
  transactionHash?: string | null;
  /** Attempt rows — defaults to a single CONFIRMED attempt. */
  attempts?: Partial<PaymentAttemptInsert>[];
}

async function seedPayment(opts: SeedOpts = {}) {
  const p: PaymentInsert = {
    id: uid("pay"),
    reference: uid("ref"),
    idempotencyKey: uid("idem"),
    customerId: uid("cust"),
    agentId: null,
    productId: opts.productId ?? null,
    orderId: null,
    amount: opts.amount ?? "10.00",
    currency: opts.currency ?? "USD",
    status: opts.status ?? "CONFIRMED",
    purpose: "checkout",
    expiresAtMs: null,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    payload: {},
  };
  await db.payments.payments.create(p);
  for (const over of opts.attempts ?? [{}]) {
    await db.payments.attempts.create({
      id: uid("att"),
      paymentId: p.id,
      provider: opts.provider ?? "DIRECT_USDC",
      network: opts.network === undefined ? "eip155:5042002" : opts.network,
      token: null,
      amount: p.amount,
      currency: p.currency ?? "USD",
      status: "CONFIRMED",
      providerReference:
        opts.providerReference === undefined
          ? null
          : opts.providerReference,
      transactionHash:
        opts.transactionHash === undefined ? "0xfeed" : opts.transactionHash,
      expiresAtMs: null,
      confirmedAtMs: p.updatedAtMs,
      payload: {},
      ...over,
    });
  }
  return p;
}

/** Commerce mirror: task → agreement → RECORD_ONLY payment → paymentId. */
async function seedCommerceMirror(paymentId: string) {
  const task = await db.commerce.tasks.create({
    id: uid("task"),
    buyerWallet: "0xbuyer",
    title: "e2e trace task",
    description: "d",
    status: "AGREED",
    payload: {},
  });
  const agreement = await db.commerce.agreements.create({
    id: uid("agr"),
    taskId: task!.id,
    offerId: uid("offer"),
    buyerWallet: "0xbuyer",
    providerWallet: "0xprovider",
    agreedAmount: "10.00",
    status: "ACTIVE",
    payload: {},
  });
  await db.commerce.payments.create({
    id: uid("cpay"),
    agreementId: agreement!.id,
    mode: "RECORD_ONLY",
    status: "PAYMENT_RECORDED",
    amount: "10.00",
    currency: "USD",
    paymentId,
    recordedBy: "0xops",
    recordedAtMs: Date.now(),
    payload: {},
  });
  return { task: task!, agreement: agreement! };
}

beforeAll(() => {
  process.env.ADMIN_API_KEY = KEY;
});

beforeEach(() => {
  verifyCalls = [];
  stripeCalls = [];
  db = createDatabase({ enabled: false });
  app = new Hono();
  app.route(
    "/",
    createFinopsRoutes({
      getDb: () => db,
      verifyRefundTx: async (txHash, expected) => {
        verifyCalls.push({ txHash, payee: expected.payee });
        return { verified: true, network: "eip155:5042002" };
      },
      stripeClient: {
        refunds: {
          create: async (input) => {
            stripeCalls.push(input.payment_intent);
            return { id: "re_e2e_1", status: "succeeded" };
          },
        },
      },
    }),
  );
});

describe("e2e — payments feed, trace, manual actions", () => {
  it("seeded payments filter correctly; detail traces to task/product; manual actions audit", async () => {
    await db.payments.products.upsert({
      id: "prod_trace",
      code: "SKU-TRACE",
      name: "Trace Product",
      description: null,
      category: "PASSPORT",
      active: true,
      payload: {},
    });
    const stripe = await seedPayment({
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_e2e_1",
      transactionHash: null,
      productId: "prod_trace",
    });
    await seedPayment({ provider: "X402", amount: "4.00" });
    const failed = await seedPayment({
      status: "FAILED",
      amount: "7.00",
      attempts: [{ status: "FAILED", confirmedAtMs: null }],
    });
    const mirror = await seedCommerceMirror(stripe.id);
    await db.payments.usageRecords.append({
      id: uid("ur"),
      paymentId: stripe.id,
      agentId: "agent-1",
      resource: "passport-request",
      requestId: uid("req"),
      amount: "1",
      currency: "USDC",
      network: "eip155:5042002",
      payerAddress: "0xabc",
      createdAtMs: Date.now(),
      payload: {},
    });

    // List filters over HTTP — provider, status.
    const byStripe = await (await get("/admin/finance/payments?provider=STRIPE")).text();
    expect(byStripe).toContain(stripe.reference);
    expect(byStripe).not.toContain(failed.reference);
    const byX402 = await (await get("/admin/finance/payments?provider=X402")).text();
    expect(byX402).not.toContain(stripe.reference);
    const byFailed = await (await get("/admin/finance/payments?status=FAILED")).text();
    expect(byFailed).toContain(failed.reference);
    expect(byFailed).not.toContain(stripe.reference);

    // Detail trace — payment → product + commerce task/agreement.
    const detail = await (
      await get(`/admin/finance/payments/${stripe.id}`)
    ).text();
    expect(detail).toContain("SKU-TRACE");
    expect(detail).toContain(mirror.task.id);
    expect(detail).toContain(mirror.agreement.id);

    // Manual actions over HTTP → AdminAction rows with operator.
    const review = await post(`/admin/finance/payments/${stripe.id}/review`, {
      operator: "ops.e2e",
      evidence: { note: "looks fine" },
    });
    expect(review.status).toBe(200);
    const retry = await post(
      `/admin/finance/payments/${stripe.id}/retry-verification`,
      { operator: "ops.e2e" },
    );
    expect(retry.status).toBe(200);
    const actions = await db.finops.adminActions.listBySubject(
      "payment",
      stripe.id,
    );
    expect(actions.map((a) => a.action).sort()).toEqual([
      "RETRY_VERIFY",
      "REVIEW",
    ]);
    expect(actions.every((a) => a.operator === "ops.e2e")).toBe(true);
  });
});

describe("e2e — refund lifecycle", () => {
  it("stripe refund + usdc intent→verified complete; every step audited", async () => {
    const stripe = await seedPayment({
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_e2e_ref",
      transactionHash: null,
      amount: "12.00",
    });
    const usdc = await seedPayment({ provider: "DIRECT_USDC", amount: "8.00" });

    // Stripe mode — provider call + payment REFUNDED.
    const s = await post(`/admin/finance/payments/${stripe.id}/refund`, {
      operator: "ops.e2e",
      mode: "stripe",
      reason: "duplicate",
    });
    expect(s.status).toBe(200);
    expect(stripeCalls).toEqual(["pi_e2e_ref"]);
    expect((await db.payments.payments.getById(stripe.id))!.status).toBe(
      "REFUNDED",
    );

    // Intent mode — OPEN intent surfaces via the ops list endpoint.
    const i = await post(`/admin/finance/payments/${usdc.id}/refund`, {
      operator: "ops.e2e",
      mode: "intent",
      payee: PAYEE,
      amount: "8.00",
      reason: "customer request",
    });
    expect(i.status).toBe(201);
    const open = (await (
      await get("/admin/finance/refunds?status=OPEN")
    ).json()) as { items: { id: string; status: string }[] };
    expect(open.items).toHaveLength(1);
    const intentId = open.items[0]!.id;

    // Complete only behind the verified txHash → COMPLETED + REFUNDED.
    const done = await post(`/admin/finance/refunds/${intentId}/complete`, {
      operator: "ops.e2e",
      txHash: TX1,
    });
    expect(done.status).toBe(200);
    expect(verifyCalls.map((v) => v.txHash)).toEqual([TX1]);
    expect((await db.finops.refundIntents.getById(intentId))!.status).toBe(
      "COMPLETED",
    );
    expect((await db.payments.payments.getById(usdc.id))!.status).toBe(
      "REFUNDED",
    );

    // Audit: STRIPE_REFUND_INITIATED + STRIPE_REFUND + INTENT_OPENED +
    // INTENT_COMPLETED — one row per audited step (226-6).
    const refunds = await db.finops.adminActions.list({ action: "REFUND" });
    expect(refunds).toHaveLength(4);
    expect(refunds.every((a) => a.operator === "ops.e2e")).toBe(true);
  });

  it("unconfigured seams 503 — no fabricated confirmations", async () => {
    const bare = new Hono();
    bare.route(
      "/",
      createFinopsRoutes({ getDb: () => db, stripeClient: null }),
    );
    const barePost = (path: string, body: Record<string, unknown>) =>
      bare.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify(body),
      });
    const p = await seedPayment();

    const stripe = await barePost(`/admin/finance/payments/${p.id}/refund`, {
      operator: "ops.e2e",
      mode: "stripe",
    });
    expect(stripe.status).toBe(503);

    const complete = await barePost("/admin/finance/refunds/ri_x/complete", {
      operator: "ops.e2e",
      txHash: "0xabc",
    });
    expect(complete.status).toBe(503);
    // Nothing written — honest failure, no side effects.
    expect(await db.finops.adminActions.list({})).toHaveLength(0);
  });
});

describe("e2e — exceptions queue", () => {
  it("seeded mismatch → detect → queue → resolve, all audited", async () => {
    const p = await seedPayment();
    await db.payments.exceptions.append({
      id: "pe_e2e_1",
      paymentId: p.id,
      kind: "DUPLICATE_TRANSFER",
      severity: "CRITICAL",
      details: { txHash: "0xaaa" },
      status: "OPEN",
      createdAtMs: Date.now(),
    });

    const det = await post("/admin/finance/exceptions/detect", {
      operator: "ops.e2e",
    });
    expect(det.status).toBe(200);

    // Work queue shows the bridged exception.
    const queue = await (await get("/admin/finance/exceptions")).text();
    expect(queue).toContain(p.id);
    const rows = await db.finops.exceptions.list({ status: "OPEN" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("ORPHAN_TX");

    const res = await post(
      `/admin/finance/exceptions/${rows[0]!.id}/resolve`,
      { operator: "ops.e2e", resolution: "MATCHED", note: "dup transfer" },
    );
    expect(res.status).toBe(200);
    const after = await db.finops.exceptions.getById(rows[0]!.id);
    expect(after!.status).toBe("RESOLVED");
    expect(after!.resolvedBy).toBe("ops.e2e");
    expect(
      await db.finops.adminActions.list({ action: "RESOLVE_EXCEPTION" }),
    ).toHaveLength(1);
  });
});

describe("e2e — reports", () => {
  it("aggregation counts payments once, excludes RECORD_ONLY, exports CSV", async () => {
    // Two attempts on one payment — counted once at terminal.
    await seedPayment({
      provider: "STRIPE",
      network: "stripe",
      amount: "10.00",
      attempts: [
        {
          id: uid("att_fail"),
          status: "FAILED",
          providerReference: "pi_fail",
          transactionHash: null,
          confirmedAtMs: null,
        },
        { status: "CONFIRMED", providerReference: "pi_ok" },
      ],
    });
    await seedPayment({
      provider: "DIRECT_USDC",
      amount: "5.00",
      currency: "USDC",
      network: "eip155:1874",
    });
    // RECORD_ONLY mirror of external settlement — never revenue.
    await db.commerce.payments.create({
      id: uid("cpay"),
      agreementId: uid("agr"),
      mode: "RECORD_ONLY",
      status: "PAYMENT_RECORDED",
      amount: "1000.00",
      currency: "USD",
      recordedBy: "0xops",
      recordedAtMs: Date.now(),
      payload: {},
    });

    const csvRes = await get("/admin/finance/reports?format=csv");
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csv = await csvRes.text();
    expect(csv).toContain("grossVolume,15.00");
    expect(csv).toContain('byProvider,"STRIPE",10.00');
    expect(csv).toContain('byProvider,"DIRECT_USDC",5.00');
    expect(csv).toContain('byNetwork,"eip155:1874",5.00');
    expect(csv).toContain("recordedOnly,count,1");
    expect(csv).toContain("recordedOnly,volume,1000.00");
    // RECORD_ONLY never leaks into revenue.
    expect(csv).not.toContain("1015");

    const page = await get("/admin/finance/reports");
    expect(page.status).toBe(200);
  });
});

describe("e2e — audit trail", () => {
  it("every manual action surfaces in the audit page with operator", async () => {
    const p = await seedPayment();
    await post(`/admin/finance/payments/${p.id}/review`, {
      operator: "ops.e2e",
    });
    await post(`/admin/finance/payments/${p.id}/retry-verification`, {
      operator: "ops.e2e",
    });
    await post(`/admin/finance/payments/${p.id}/refund`, {
      operator: "ops.e2e",
      mode: "intent",
      payee: PAYEE,
      amount: "5.00",
      reason: "x",
    });
    const exc = await db.finops.exceptions.append({
      id: "rx_e2e_audit",
      type: "MISSING_TX",
      subjectRef: p.id,
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    await post(`/admin/finance/exceptions/${exc!.id}/resolve`, {
      operator: "ops.e2e",
      resolution: "IGNORED",
    });

    const html = await (
      await get("/admin/finance/audit?operator=ops.e2e")
    ).text();
    for (const action of [
      "REVIEW",
      "RETRY_VERIFY",
      "REFUND",
      "RESOLVE_EXCEPTION",
    ]) {
      expect(html).toContain(action);
    }
    expect(html).toContain("ops.e2e");

    // Append-only invariant — every row carries an operator.
    const rows = await db.finops.adminActions.list({});
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.operator.trim() !== "")).toBe(true);
  });
});
