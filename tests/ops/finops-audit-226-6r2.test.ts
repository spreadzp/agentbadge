/**
 * EPIC-226 / SLICE-226-6 — round-2 re-audit fix regressions.
 *
 * REVIEW-FINDINGS-v2.md returned REQUEST CHANGES after round 1;
 * these cover the second-pass findings: bounded audit evidence
 * (N1/N2/N3), Stripe failure terminal rows + intent-path lock (N4),
 * operator normalization gaps (N6), cumulative REFUNDED flip (N10),
 * verifier resilience (N11), reject-audit markers (N12), prototype-
 * safe split accumulators (N13), subject existence (N19).
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
  finReport,
  listAdminActions,
  markExternalReviewed,
  recordAdminAction,
  resolveException,
  reviewPayment,
  stripeRefund,
} from "../../src/server/lib/finops";

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;

const PAYEE = "0x" + "a".repeat(40);
const PAYEE_B = "0x" + "b".repeat(40);
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

describe("SLICE-226-6 round-2 fixes (re-audit)", () => {
  it("N1/L-7: >1KB caller evidence rejected upfront; ≤1KB flips + audits", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" }, {
      provider: "STRIPE",
      providerReference: "pi_n1",
      network: "stripe",
      transactionHash: null,
    });
    // Oversized evidence is refused BEFORE the INITIATED row — the
    // operator's justification is never silently truncated after the
    // refund already happened (L-7).
    const big = await stripeRefund(
      db,
      {
        paymentId: p.id,
        operator: "ops",
        evidence: { blob: "x".repeat(3900) },
      },
      { refunds: { create: async () => ({ id: "re_n1", status: "succeeded" }) } },
    );
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error.code).toBe("BAD_INPUT");
    expect(await db.finops.adminActions.list({})).toHaveLength(0);
    const r = await stripeRefund(
      db,
      {
        paymentId: p.id,
        operator: "ops",
        evidence: { blob: "x".repeat(900) },
      },
      { refunds: { create: async () => ({ id: "re_n1", status: "succeeded" }) } },
    );
    expect(r.ok).toBe(true);
    expect((await db.payments.payments.getById(p.id))?.status).toBe("REFUNDED");
    await db.close();
  });

  it("N2: oversized resolve note is BAD_INPUT before the transition", async () => {
    const db = createDatabase({ enabled: false });
    const det = await detectExceptions(db, [
      { id: "rx_n2", type: "ORPHAN_TX", subjectRef: "0xabc" },
    ]);
    if (!det.ok) throw new Error("detect failed");
    const r = await resolveException(db, {
      id: "rx_n2",
      resolution: "IGNORED",
      operator: "ops",
      note: "n".repeat(600),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    // Still OPEN — the note was rejected before the effect.
    expect((await db.finops.exceptions.getById("rx_n2"))?.status).toBe("OPEN");
    await db.close();
  });

  it("N4: intent on a Stripe-settled payment is rejected outright", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" }, {
      provider: "STRIPE",
      providerReference: "pi_c2",
      network: "stripe",
      transactionHash: null,
    });
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    // The on-chain arm must not double-refund a card-paid payment.
    expect(i.ok).toBe(false);
    if (!i.ok) expect(i.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("N4/M-6: pending → UNCERTAIN keeps the lock; definite fail → FAILED unlocks", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" }, {
      provider: "STRIPE",
      providerReference: "pi_fail",
      network: "stripe",
      transactionHash: null,
    });
    const r = await stripeRefund(
      db,
      { paymentId: p.id, operator: "ops" },
      {
        refunds: {
          create: async () => ({ id: "re_pend", status: "pending" }),
        },
      },
    );
    expect(r.ok).toBe(false);
    // INITIATED + STRIPE_REFUND_UNCERTAIN — pending may still settle,
    // so the trail records the refund id but the lock STAYS (M-6).
    const actions = (await listAdminActions(db, { action: "REFUND" }))
      .map((a) => (a.evidence as Record<string, unknown>)?.kind);
    expect(actions).toContain("STRIPE_REFUND_INITIATED");
    expect(actions).toContain("STRIPE_REFUND_UNCERTAIN");
    expect(actions).not.toContain("STRIPE_REFUND_FAILED");
    // A definite rejection (status "failed") IS a terminal row.
    const p2 = await seedConfirmed(db, { amount: "10.00" }, {
      provider: "STRIPE",
      providerReference: "pi_def",
      network: "stripe",
      transactionHash: null,
    });
    const r2 = await stripeRefund(
      db,
      { paymentId: p2.id, operator: "ops" },
      {
        refunds: {
          create: async () => ({ id: "re_def", status: "failed" }),
        },
      },
    );
    expect(r2.ok).toBe(false);
    const actions2 = (
      await db.finops.adminActions.listBySubject("payment", p2.id)
    )
      .filter((a) => a.action === "REFUND")
      .map((a) => (a.evidence as Record<string, unknown>)?.kind);
    expect(actions2).toContain("STRIPE_REFUND_FAILED");
    await db.close();
  });

  it("N4: initiated-without-terminal Stripe attempt locks the intent path", async () => {
    const db = createDatabase({ enabled: false });
    // On-chain payment — intent path is allowed in principle…
    const p = await seedConfirmed(db, { amount: "10.00" });
    // …but an ops Stripe attempt died after INITIATED (crash/pending):
    await recordAdminAction(db, {
      action: "REFUND",
      subjectType: "payment",
      subjectId: p.id,
      operator: "ops",
      evidence: { kind: "STRIPE_REFUND_INITIATED", idempotencyKey: "k" },
    });
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    expect(i.ok).toBe(false);
    if (!i.ok) expect(i.error.code).toBe("INVALID_STATE");
    // A terminal row releases the lock.
    await recordAdminAction(db, {
      action: "REFUND",
      subjectType: "payment",
      subjectId: p.id,
      operator: "ops",
      evidence: { kind: "STRIPE_REFUND_FAILED", error: "x" },
    });
    const ok2 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    expect(ok2.ok).toBe(true);
    await db.close();
  });

  it("N6: blank-lookalike operators rejected; normalize is idempotent", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    for (const bad of [
      "\u3164", // U+3164 hangul filler — Lo, not a Cf
      "\u2800", // U+2800 braille blank — So
      "\u1160", // U+1160 jungseong filler
      "\u034F", // U+034F combining grapheme joiner
    ]) {
      const r = await reviewPayment(db, p.id, bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("OPERATOR_REQUIRED");
    }
    // Tab/newline collapse to a space, not deletion.
    await reviewPayment(db, p.id, "al\tice\nx");
    const rows = await listAdminActions(db);
    expect(rows.at(-1)?.operator).toBe("al ice x");
    // Idempotent — intent operator and audit operator agree.
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "1.00",
      reason: "r", operator: "e\u200D\u0301",
    });
    if (!i.ok) throw new Error("intent create failed");
    expect(i.value.operator).toBe("é");
    await db.close();
  });

  it("N10: cumulative completions flip the payment to REFUNDED", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const i1 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "6.00",
      reason: "r", operator: "ops",
    });
    const i2 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE_B, amount: "4.00",
      reason: "r", operator: "ops",
    });
    if (!i1.ok || !i2.ok) throw new Error("intent create failed");
    const verify = async () => ({ verified: true });
    await completeRefundIntent(
      db, { intentId: i1.value.id, txHash: TX1, operator: "ops" }, verify,
    );
    // 60% refunded — still CONFIRMED.
    expect((await db.payments.payments.getById(p.id))?.status).toBe("CONFIRMED");
    await completeRefundIntent(
      db, { intentId: i2.value.id, txHash: TX2, operator: "ops" }, verify,
    );
    // 100% cumulative — payment leaves revenue.
    expect((await db.payments.payments.getById(p.id))?.status).toBe("REFUNDED");
    await db.close();
  });

  it("N11: verifier throw → PROVIDER_ERROR, not a crash", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "5.00" });
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "5.00",
      reason: "r", operator: "ops",
    });
    if (!i.ok) throw new Error("intent create failed");
    const r = await completeRefundIntent(
      db, { intentId: i.value.id, txHash: TX1, operator: "ops" },
      async () => { throw new Error("rpc down"); },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PROVIDER_ERROR");
    // Intent survives OPEN — a verifier outage is retryable.
    expect((await db.finops.refundIntents.getById(i.value.id))?.status).toBe("OPEN");
    await db.close();
  });

  it("N12: rejected completions leave an audited reject marker", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "5.00" });
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "5.00",
      reason: "r", operator: "ops",
    });
    if (!i.ok) throw new Error("intent create failed");
    await completeRefundIntent(
      db, { intentId: i.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: false, reason: "no such tx" }),
    );
    const kinds = (await listAdminActions(db, { action: "REFUND" }))
      .map((a) => (a.evidence as Record<string, unknown>)?.kind);
    expect(kinds).toContain("INTENT_COMPLETE_REJECTED");
    await db.close();
  });

  it("N13: __proto__ productId stays in the product split", async () => {
    const db = createDatabase({ enabled: false });
    await seedConfirmed(db, { amount: "5.00", productId: "__proto__" });
    const rep = await finReport(db);
    expect(rep.byProduct["__proto__"]).toBe("5.00");
    await db.close();
  });

  it("N19: external review on a missing payment → NOT_FOUND", async () => {
    const db = createDatabase({ enabled: false });
    const r = await markExternalReviewed(
      db, "payment", "pay_ghost", "ops", { u: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    await db.close();
  });
});
