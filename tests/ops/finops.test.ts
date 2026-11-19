/**
 * EPIC-226 / SLICE-226-2 — FinOps domain services tests.
 *
 * Covers the slice acceptance criteria:
 * 1. Read-models: attempts roll-up, counted-once, RECORD_ONLY excluded.
 * 2. Every manual action writes AdminAction; missing operator rejected.
 * 3. RefundIntent completion requires a verified txHash (mock verify).
 * 4. Exception detect/resolve lifecycle.
 *
 * Runs on the in-memory Database (createDatabase({enabled:false})) —
 * store parity is covered by the database package suite.
 */

import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@agentbadge/database";
import type {
  PaymentAttemptInsert,
  PaymentInsert,
} from "@agentbadge/database";

import {
  completeRefundIntent,
  createRefundIntent,
  detectExceptions,
  detectFromPaymentExceptions,
  getPaymentDetail,
  listAdminActions,
  listExceptions,
  listPayments,
  listRefundIntents,
  markExternalReviewed,
  resolveException,
  retryVerification,
  reviewPayment,
  stripeRefund,
  tracePayment,
} from "../../src/server/lib/finops";

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;

const PAYEE = "0x" + "a".repeat(40);
const TX1 = "0x" + "d".repeat(64);
const TX2 = "0x" + "e".repeat(64);

const mkPayment = (over: Partial<PaymentInsert> = {}): PaymentInsert => ({
  id: uid("pay"),
  reference: uid("ref"),
  idempotencyKey: uid("idem"),
  customerId: uid("cust"),
  agentId: null,
  productId: null,
  orderId: null,
  amount: "19.99",
  currency: "USD",
  status: "PENDING",
  purpose: "PASSPORT",
  expiresAtMs: null,
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  payload: {},
  ...over,
});

const mkAttempt = (
  paymentId: string,
  over: Partial<PaymentAttemptInsert> = {},
): PaymentAttemptInsert => ({
  id: uid("att"),
  paymentId,
  // N4/226-6r2: intents require an on-chain confirmed attempt —
  // STRIPE must be opted into explicitly by stripe-path tests.
  provider: "DIRECT_USDC",
  network: "base",
  token: null,
  amount: "19.99",
  currency: "USD",
  status: "CREATED",
  providerReference: uid("tx"),
  transactionHash: null,
  expiresAtMs: null,
  confirmedAtMs: null,
  payload: {},
  ...over,
});

const seedConfirmed = async (
  db: Database,
  over: Partial<PaymentInsert> = {},
  attemptOver: Partial<PaymentAttemptInsert> = {},
) => {
  const p = mkPayment({ status: "CONFIRMED", ...over });
  await db.payments.payments.create(p);
  await db.payments.attempts.create(
    mkAttempt(p.id, {
      status: "CONFIRMED",
      confirmedAtMs: p.updatedAtMs,
      ...attemptOver,
    }),
  );
  return p;
};

describe("finops read-models", () => {
  it("listPayments filters by status/provider and paginates", async () => {
    const db = createDatabase({ enabled: false });
    const a = await seedConfirmed(db, {}, {
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_a",
    });
    const b = await seedConfirmed(db, { status: "FAILED" });
    await seedConfirmed(db);
    // provider filter via attempts
    const stripe = await listPayments(db, { provider: "STRIPE" });
    expect(stripe.items.some((i) => i.id === a.id)).toBe(true);
    expect(stripe.items.every((i) => i.provider === "STRIPE")).toBe(true);
    const x402 = await listPayments(db, { provider: "X402" });
    expect(x402.items.length).toBe(0);
    // status filter
    const failed = await listPayments(db, { status: "FAILED" });
    expect(failed.items.map((i) => i.id)).toEqual([b.id]);
    // pagination
    const page1 = await listPayments(db, { perPage: 2, page: 1 });
    expect(page1.items.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await listPayments(db, { perPage: 2, page: 2 });
    expect(page2.items.length).toBe(1);
    expect(page2.hasMore).toBe(false);
    await db.close();
  });

  it("getPaymentDetail rolls up attempts/receipts/events/refunds/actions", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, {}, {
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_det",
    });
    await db.payments.events.append({
      id: uid("ev"),
      entity: "PAYMENT",
      paymentId: p.id,
      attemptId: null,
      from: "PENDING",
      to: "CONFIRMED",
      actor: "monitor",
      reason: null,
      atMs: Date.now(),
      payload: {},
    });
    await reviewPayment(db, p.id, "ops-alice");
    const detail = await getPaymentDetail(db, p.id);
    expect(detail).not.toBeNull();
    expect(detail!.payment.id).toBe(p.id);
    expect(detail!.attempts.length).toBe(1);
    expect(detail!.provider).toBe("STRIPE");
    expect(detail!.events.length).toBe(1);
    expect(detail!.adminActions.length).toBe(1);
    expect(detail!.adminActions[0]!.action).toBe("REVIEW");
    expect(await getPaymentDetail(db, "nope")).toBeNull();
    await db.close();
  });

  it("tracePayment links product/usage and commerce mirror", async () => {
    const db = createDatabase({ enabled: false });
    await db.payments.products.upsert({
      id: "prod_t",
      code: "SKU-T",
      name: "Test Product",
      description: null,
      category: "PASSPORT",
      active: true,
      payload: {},
    });
    const p = await seedConfirmed(db, { productId: "prod_t" });
    await db.payments.usageRecords.append({
      id: uid("ur"),
      paymentId: p.id,
      agentId: "agent-1",
      resource: "passport-request",
      requestId: uid("req"),
      amount: "1",
      currency: "USDC",
      network: "eip155:1874",
      payerAddress: "0xabc",
      createdAtMs: Date.now(),
      payload: {},
    });
    const trace = await tracePayment(db, p.id);
    expect(trace).not.toBeNull();
    expect(trace!.product?.code).toBe("SKU-T");
    expect(trace!.usageRecords.length).toBe(1);
    expect(trace!.related.agreementId).toBeNull();
    await db.close();
  });
});


describe("finops admin actions", () => {
  it("rejects missing/empty operator on every path", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    for (const r of [
      await reviewPayment(db, p.id, ""),
      await reviewPayment(db, p.id, "   "),
      await retryVerification(db, p.id, ""),
      await markExternalReviewed(db, "payment", p.id, "", { u: 1 }),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("OPERATOR_REQUIRED");
    }
    expect((await listAdminActions(db)).length).toBe(0);
    await db.close();
  });

  it("rejects evidence over 4KB", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    const big = { blob: "x".repeat(5000) };
    const r = await reviewPayment(db, p.id, "ops", big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EVIDENCE_TOO_LARGE");
    await db.close();
  });

  it("every manual action writes an AdminAction row", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    await reviewPayment(db, p.id, "ops-a", { note: "looks fine" });
    await markExternalReviewed(db, "payment", p.id, "ops-b", {
      url: "https://evidence.example/1",
    });
    const actions = await listAdminActions(db);
    expect(actions.length).toBe(2);
    expect(actions.map((a) => a.action).sort()).toEqual([
      "MARK_EXTERNAL_REVIEWED",
      "REVIEW",
    ]);
    expect(actions.every((a) => a.operator.startsWith("ops-"))).toBe(true);
    await db.close();
  });

  it("retryVerification audits and returns retryable attempts", async () => {
    const db = createDatabase({ enabled: false });
    const p = mkPayment({ status: "PENDING" });
    await db.payments.payments.create(p);
    await db.payments.attempts.create(
      mkAttempt(p.id, { status: "PENDING" }),
    );
    const r = await retryVerification(db, p.id, "ops");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.action.action).toBe("RETRY_VERIFY");
      expect(r.value.retryableAttempts.length).toBe(1);
    }
    // NOT_FOUND on missing payment
    const miss = await retryVerification(db, "nope", "ops");
    expect(miss.ok).toBe(false);
    await db.close();
  });

  it("markExternalReviewed requires evidence", async () => {
    const db = createDatabase({ enabled: false });
    const r = await markExternalReviewed(
      db,
      "agreement",
      "agr_1",
      "ops",
      {},
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    await db.close();
  });
});

describe("finops refund intents", () => {
  it("create validates payment state and amount", async () => {
    const db = createDatabase({ enabled: false });
    const pend = mkPayment({ status: "PENDING" });
    await db.payments.payments.create(pend);
    const bad = await createRefundIntent(db, {
      paymentId: pend.id,
      payee: PAYEE,
      amount: "1.00",
      reason: "test",
      operator: "ops",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("INVALID_STATE");

    const conf = await seedConfirmed(db, { amount: "10.00" });
    const tooBig = await createRefundIntent(db, {
      paymentId: conf.id,
      payee: PAYEE,
      amount: "11.00",
      reason: "test",
      operator: "ops",
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error.code).toBe("BAD_INPUT");

    const good = await createRefundIntent(db, {
      paymentId: conf.id,
      payee: PAYEE,
      amount: "10.00",
      reason: "customer request",
      operator: "ops",
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.status).toBe("OPEN");
    await db.close();
  });

  it("complete requires verified txHash — unverified stays OPEN", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const intent = await createRefundIntent(db, {
      paymentId: p.id,
      payee: PAYEE,
      amount: "10.00",
      reason: "test",
      operator: "ops",
    });
    if (!intent.ok) throw new Error("intent create failed");
    // Unverified tx — no completion, no fabricated confirmation.
    const bad = await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: false, reason: "tx not found" }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("TX_UNVERIFIED");
    expect(
      (await db.finops.refundIntents.getById(intent.value.id))?.status,
    ).toBe("OPEN");
    // Verified tx — completes + audits + payment flips REFUNDED.
    const good = await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX2, operator: "ops" },
      async (_tx, exp) => ({
        verified: exp.payee === PAYEE,
        network: "eip155:1874",
        confirmations: 12,
      }),
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.status).toBe("COMPLETED");
      expect(good.value.txHash).toBe(TX2);
    }
    expect((await db.payments.payments.getById(p.id))?.status).toBe(
      "REFUNDED",
    );
    // Second completion — guarded transition refuses.
    const again = await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX2, operator: "ops" },
      async () => ({ verified: true }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("stripeRefund calls provider, audits, marks REFUNDED", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" }, {
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_stripe_1",
    });
    const calls: string[] = [];
    const r = await stripeRefund(
      db,
      { paymentId: p.id, operator: "ops" },
      {
        refunds: {
          create: async (input) => {
            calls.push(input.payment_intent);
            return { id: "re_test_1", status: "succeeded" };
          },
        },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.stripeRefundId).toBe("re_test_1");
    expect(calls.length).toBe(1);
    expect((await db.payments.payments.getById(p.id))?.status).toBe(
      "REFUNDED",
    );
    const actions = await listAdminActions(db, { action: "REFUND" });
    expect(actions.length).toBe(2); // INITIATED + STRIPE_REFUND
    // No STRIPE attempt → hard fail.
    const usdc = mkPayment({ status: "CONFIRMED" });
    await db.payments.payments.create(usdc);
    await db.payments.attempts.create(
      mkAttempt(usdc.id, {
        provider: "DIRECT_USDC",
        providerReference: null,
        status: "CONFIRMED",
        confirmedAtMs: Date.now(),
      }),
    );
    const noStripe = await stripeRefund(
      db,
      { paymentId: usdc.id, operator: "ops" },
      { refunds: { create: async () => ({ id: "re_x" }) } },
    );
    expect(noStripe.ok).toBe(false);
    await db.close();
  });

  it("listRefundIntents filters by status/payment", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    await createRefundIntent(db, {
      paymentId: p.id,
      payee: PAYEE,
      amount: "5.00",
      reason: "a",
      operator: "ops",
    });
    const open = await listRefundIntents(db, { status: "OPEN" });
    expect(open.length).toBe(1);
    const byPayment = await listRefundIntents(db, { paymentId: p.id });
    expect(byPayment.length).toBe(1);
    await db.close();
  });
});

describe("finops exceptions", () => {
  it("detect dedupes deterministic ids; resolve lifecycle audited", async () => {
    const db = createDatabase({ enabled: false });
    const first = await detectExceptions(db, [
      {
        id: "rx_det_1",
        type: "AMOUNT_MISMATCH",
        subjectRef: "pay_1",
        details: { expected: "10", got: "9" },
      },
    ]);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.created.length).toBe(1);
    // Re-scan — same deterministic id dedupes.
    const second = await detectExceptions(db, [
      { id: "rx_det_1", type: "AMOUNT_MISMATCH", subjectRef: "pay_1" },
    ]);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.created.length).toBe(0);
      expect(second.value.skipped).toEqual(["rx_det_1"]);
    }
    // Resolve — operator + valid resolution → RESOLVED + audit.
    const res = await resolveException(db, {
      id: "rx_det_1",
      resolution: "MANUAL_ADJUSTED",
      operator: "ops",
      note: "adjusted books",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe("RESOLVED");
      expect(res.value.resolution).toBe("MANUAL_ADJUSTED");
      expect(res.value.resolvedBy).toBe("ops");
      // Post-effect audit landed — surfaced, never swallowed (M-2/R3.2).
      expect(res.value.auditRecorded).toBe(true);
    }
    const audit = await listAdminActions(db, {
      action: "RESOLVE_EXCEPTION",
    });
    expect(audit.length).toBe(1);
    // Double-resolve refused.
    const twice = await resolveException(db, {
      id: "rx_det_1",
      resolution: "IGNORED",
      operator: "ops",
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe("INVALID_STATE");
    // Missing operator refused.
    const noOp = await detectExceptions(db, [
      { type: "ORPHAN_TX", subjectRef: "0xabc" },
    ]);
    expect(noOp.ok).toBe(true);
    const listed = await listExceptions(db, { status: "OPEN" });
    expect(listed.length).toBe(1);
    const badResolve = await resolveException(db, {
      id: listed[0]!.id,
      resolution: "IGNORED",
      operator: "",
    });
    expect(badResolve.ok).toBe(false);
    await db.close();
  });

  it("detectFromPaymentExceptions bridges the ops queue", async () => {
    const db = createDatabase({ enabled: false });
    await db.payments.exceptions.append({
      id: "pe_1",
      paymentId: "pay_x",
      attemptId: "att_x",
      kind: "DUPLICATE_TRANSFER",
      severity: "CRITICAL",
      details: { txHash: "0xaaa" },
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    await db.payments.exceptions.append({
      id: "pe_2",
      kind: "REFUND_REQUEST",
      severity: "WARN",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const r = await detectFromPaymentExceptions(db);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // REFUND_REQUEST is not reconciliation work — skipped.
      expect(r.value.created.length).toBe(1);
      expect(r.value.created[0]!.type).toBe("ORPHAN_TX");
      expect(r.value.created[0]!.subjectRef).toBe("pay_x");
    }
    // Re-run — dedupe by `rx_pe_1`.
    const again = await detectFromPaymentExceptions(db);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.created.length).toBe(0);
    await db.close();
  });
});
