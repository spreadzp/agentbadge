/**
 * SLICE-226-6 — regression suite for Arc re-audit round 4
 * (REVIEW-FINDINGS-v4.md): N4-1..N4-7 plus verified lows.
 * Every test pins the fixed behavior so a regression is a failure.
 */

import { describe, expect, it } from "vitest";
import {
  createDatabase,
  type Database,
  type PaymentAttemptInsert,
  type PaymentInsert,
} from "@agentbadge/database";

import {
  completeRefundIntent,
  createRefundIntent,
  detectExceptions,
  detectFromPaymentExceptions,
  finReport,
  listPayments,
  recordPostEffectAudit,
  resolveStripeRefund,
  stripeRefund,
} from "../../src/server/lib/finops";
import {
  LockAcquireTimeoutError,
  withLock,
} from "../../src/server/lib/finops/payment-mutex";

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
  amount: "10.00",
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
  provider: "DIRECT_USDC",
  network: "eip155:5042002",
  token: null,
  amount: "10.00",
  currency: "USDC",
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

describe("SLICE-226-6 round-4 fixes (re-audit v4)", () => {
  it("N4-1: scoped lock keys — payment id `tx:<hash>` cannot alias the tx lock", async () => {
    // Under the un-namespaced scheme a payment id equal to `tx:<hash>`
    // made the outer and inner lock keys identical → self-deadlock.
    // With scopes the same id is a distinct key and resolves.
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { id: `tx:${TX1}` });
    const intent = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "5.00",
      reason: "r", operator: "ops",
    });
    if (!intent.ok) throw new Error("intent create failed");
    const done = await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX1, operator: "ops" },
      async (_tx, exp) => ({ verified: exp.payee === PAYEE }),
    );
    expect(done.ok).toBe(true);
    // Directly: nested "pay" then "tx" on the SAME id must not block.
    const nested = withLock("pay", `tx:${TX2}`, () =>
      withLock("tx", TX2, async () => 42),
    );
    await expect(nested).resolves.toBe(42);
    await db.close();
  });

  it("N4-1b: a wedged holder cannot queue mutations forever — acquire timeout", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holder = withLock("pay", "wedged", () => gate.then(() => 1));
    // The waiter gives up quickly instead of queueing forever; its
    // queued slot becomes a no-op so the holder still finishes.
    await expect(
      withLock("pay", "wedged", async () => 2, 50),
    ).rejects.toBeInstanceOf(LockAcquireTimeoutError);
    release();
    await expect(holder).resolves.toBe(1);
    // Queue drained — the lock is free again.
    await expect(
      withLock("pay", "wedged", async () => 3, 50),
    ).resolves.toBe(3);
  });

  it("N4-2: thrown audit-store errors degrade to typed failure, not escape", async () => {
    const db = createDatabase({ enabled: false });
    const actionsStore = db.finops.adminActions as unknown as Record<
      string,
      unknown
    >;
    const origAppend = actionsStore["append"];
    actionsStore["append"] = async () => {
      throw new Error("store exploded");
    };
    const r = await recordPostEffectAudit(
      db,
      {
        action: "REFUND",
        subjectType: "payment",
        subjectId: "pay_x",
        operator: "ops",
        evidence: { kind: "STRIPE_REFUND" },
      },
      { kind: "STRIPE_REFUND" },
    );
    actionsStore["append"] = origAppend;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PROVIDER_ERROR");
    await db.close();
  });

  it("N4-2b: thrown payment flip after intent completed → success + needsReconcile", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    const intent = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "10.00",
      reason: "r", operator: "ops",
    });
    if (!intent.ok) throw new Error("intent create failed");
    const paymentsStore = db.payments.payments as unknown as Record<
      string,
      unknown
    >;
    const origApply = paymentsStore["applyStatus"];
    paymentsStore["applyStatus"] = async () => {
      throw new Error("pg down");
    };
    const done = await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: true }),
    );
    paymentsStore["applyStatus"] = origApply;
    // The intent COMPLETED — a flip failure must not 500 after the
    // transition; the trail marks it needsReconcile instead.
    expect(done.ok).toBe(true);
    const kinds = (
      await db.finops.adminActions.listBySubject("payment", p.id)
    ).map((a) => (a.evidence as Record<string, unknown>));
    expect(
      kinds.some(
        (e) => e["kind"] === "INTENT_COMPLETED" &&
          e["needsReconcile"] === true,
      ),
    ).toBe(true);
    await db.close();
  });

  it("N4-4: corrupt revenue row → controlled PROVIDER_ERROR naming the payment", async () => {
    const db = createDatabase({ enabled: false });
    await db.payments.payments.create(
      mkPayment({ status: "CONFIRMED", amount: "not-a-decimal" }),
    );
    const rep = await finReport(db);
    expect(rep.ok).toBe(false);
    if (!rep.ok) {
      expect(rep.error.code).toBe("PROVIDER_ERROR");
      expect(rep.error.message).toContain("corrupt amount");
    }
    await db.close();
  });

  it("N4-4b: malformed RECORD_ONLY mirror is counted, not fatal", async () => {
    const db = createDatabase({ enabled: false });
    await db.commerce.payments.create({
      id: uid("cpay"),
      agreementId: uid("agr"),
      mode: "RECORD_ONLY",
      status: "PAYMENT_RECORDED",
      amount: "garbage",
      currency: "USD",
      recordedBy: "0xops",
      recordedAtMs: Date.now(),
      payload: {},
    });
    const rep = await finReport(db);
    expect(rep.ok).toBe(true);
    if (rep.ok) {
      expect(rep.value.recordedOnly.count).toBe(1);
      expect(rep.value.recordedOnly.invalidAmounts).toBe(1);
      expect(rep.value.recordedOnly.volume).toBe("0");
    }
    await db.close();
  });

  it("N4-5: Stripe refund requires exactly ONE confirmed Stripe settlement", async () => {
    const db = createDatabase({ enabled: false });
    // Stripe + on-chain double settlement — no single-refund path.
    const mixed = await seedConfirmed(db, {}, {
      provider: "STRIPE",
      providerReference: "pi_mixed",
      network: "stripe",
    });
    await db.payments.attempts.create(
      mkAttempt(mixed.id, {
        status: "CONFIRMED",
        confirmedAtMs: Date.now(),
      }),
    );
    const r1 = await stripeRefund(
      db,
      { paymentId: mixed.id, operator: "ops" },
      { refunds: { create: async () => ({ id: "re_x", status: "succeeded" }) } },
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("INVALID_STATE");
    // Two confirmed Stripe legs — also no single refund.
    const dup = await seedConfirmed(db, {}, {
      provider: "STRIPE",
      providerReference: "pi_a",
      network: "stripe",
    });
    await db.payments.attempts.create(
      mkAttempt(dup.id, {
        provider: "STRIPE",
        providerReference: "pi_b",
        network: "stripe",
        status: "CONFIRMED",
        confirmedAtMs: Date.now(),
      }),
    );
    const r2 = await stripeRefund(
      db,
      { paymentId: dup.id, operator: "ops" },
      { refunds: { create: async () => ({ id: "re_y", status: "succeeded" }) } },
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("N4-6: 408/409 provider errors stay UNCERTAIN — money may be moving", async () => {
    const db = createDatabase({ enabled: false });
    for (const statusCode of [408, 409]) {
      const p = await seedConfirmed(db, {}, {
        provider: "STRIPE",
        providerReference: `pi_${statusCode}`,
        network: "stripe",
      });
      const r = await stripeRefund(
        db,
        { paymentId: p.id, operator: "ops" },
        {
          refunds: {
            create: async () => {
              throw Object.assign(new Error("http"), { statusCode });
            },
          },
        },
      );
      expect(r.ok).toBe(false);
      const kinds = (
        await db.finops.adminActions.listBySubject("payment", p.id)
      ).map((a) => (a.evidence as Record<string, unknown>)?.kind);
      expect(kinds).toContain("STRIPE_REFUND_UNCERTAIN");
      expect(kinds).not.toContain("STRIPE_REFUND_FAILED");
    }
    await db.close();
  });

  it("N4-6b: resolveStripeRefund closes an UNCERTAIN initiation", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, {}, {
      provider: "STRIPE",
      providerReference: "pi_unc",
      network: "stripe",
    });
    // Provider throws → UNCERTAIN terminal row, in-flight lock stays.
    await stripeRefund(
      db,
      { paymentId: p.id, operator: "ops" },
      {
        refunds: {
          create: async () => {
            throw Object.assign(new Error("timeout"), { statusCode: 408 });
          },
        },
      },
    );
    // The manual arm is locked while UNCERTAIN…
    const blocked = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "1.00",
      reason: "r", operator: "ops",
    });
    expect(blocked.ok).toBe(false);
    // …an operator verifies out-of-band the refund DID land.
    const res = await resolveStripeRefund(db, {
      paymentId: p.id,
      operator: "ops",
      landed: true,
      evidence: { checked: "stripe dashboard re_uncc" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.paymentFlip).toBe(true);
    expect(
      (await db.payments.payments.getById(p.id))?.status,
    ).toBe("REFUNDED");
    // No open initiation → resolving again is INVALID_STATE.
    const again = await resolveStripeRefund(db, {
      paymentId: p.id,
      operator: "ops",
      landed: false,
      evidence: { checked: "nope" },
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("N4-7: refund totals count each intent in its OWN completedAtMs window", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    // Two partial refunds: 4.00 completed long ago, 6.00 now.
    const i1 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    if (!i1.ok) throw new Error("i1");
    const old = await completeRefundIntent(
      db,
      { intentId: i1.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: true }),
    );
    if (!old.ok) throw new Error("old complete");
    // Distinct completedAtMs — the two intents must land in
    // separable windows (same-ms timestamps would be one window).
    await new Promise((r) => setTimeout(r, 15));
    const i2 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "6.00",
      reason: "r", operator: "ops",
    });
    if (!i2.ok) throw new Error("i2");
    const now = await completeRefundIntent(
      db,
      { intentId: i2.value.id, txHash: TX2, operator: "ops" },
      async () => ({ verified: true }),
    );
    if (!now.ok) throw new Error("now complete");
    const tOld = old.value.completedAtMs ?? 0;
    const tNew = now.value.completedAtMs ?? 0;
    expect(tNew).toBeGreaterThan(tOld);
    // Window covering ONLY the second completion: the refund total is
    // 6.00 — the older intent belongs to its own window and the
    // payment's REFUNDED status must not resurrect p.amount.
    const windowed = await finReport(db, {
      sinceMs: tOld + 1,
      untilMs: tNew + 1,
    });
    expect(windowed.ok).toBe(true);
    if (windowed.ok) {
      expect(windowed.value.refundsTotal).toBe("6.00");
    }
    await db.close();
  });

  it("L4-3: oversized candidate ids are rejected before the append", async () => {
    const db = createDatabase({ enabled: false });
    const r = await detectExceptions(db, [
      {
        id: `rx_${"x".repeat(300)}`,
        type: "ORPHAN_TX",
        subjectRef: "0xabc",
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    await db.close();
  });

  it("L4-4: NaN/negative detect limits floor to the default scan budget", async () => {
    const db = createDatabase({ enabled: false });
    await db.payments.exceptions.append({
      id: uid("pe"),
      paymentId: uid("pay"),
      kind: "ORPHAN_TX",
      severity: "WARN",
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const nan = await detectFromPaymentExceptions(db, {
      limit: Number.NaN,
    });
    expect(nan.ok).toBe(true);
    if (nan.ok) expect(nan.value.created.length).toBe(1);
    const neg = await detectFromPaymentExceptions(db, { limit: -5 });
    expect(neg.ok).toBe(true);
    await db.close();
  });

  it("L4-5: fractional/NaN pagination floors safely in the read model", async () => {
    const db = createDatabase({ enabled: false });
    await seedConfirmed(db);
    const frac = await listPayments(db, { page: 0.7, perPage: 2.9 });
    expect(frac.page).toBe(1);
    expect(frac.perPage).toBe(2);
    const nan = await listPayments(db, {
      page: Number.NaN,
      perPage: Number.NaN,
    });
    expect(nan.page).toBe(1);
    expect(nan.perPage).toBeGreaterThan(0);
    await db.close();
  });

  it("L4-6: mixed on-chain settlement currencies reject the intent path", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, {}, { currency: "USDC" });
    // Second on-chain settlement in a DIFFERENT asset.
    await db.payments.attempts.create(
      mkAttempt(p.id, {
        status: "CONFIRMED",
        confirmedAtMs: Date.now(),
        currency: "ETH",
      }),
    );
    const r = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "1.00",
      reason: "r", operator: "ops",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STATE");
    await db.close();
  });
});

describe("finops reports", () => {
  it("counts each payment once at terminal; no double-count on attempts", async () => {
    const db = createDatabase({ enabled: false });
    // One payment, two attempts (first failed, second confirmed) —
    // gross must count the payment once.
    const p = mkPayment({ status: "CONFIRMED", amount: "10.00" });
    await db.payments.payments.create(p);
    await db.payments.attempts.create(
      mkAttempt(p.id, {
        id: uid("att_fail"),
        status: "FAILED",
        providerReference: uid("pi_f"),
      }),
    );
    await db.payments.attempts.create(
      mkAttempt(p.id, {
        id: uid("att_ok"),
        status: "CONFIRMED",
        confirmedAtMs: Date.now(),
      }),
    );
    const repR = await finReport(db);
    if (!repR.ok) throw new Error("report failed");
    expect(repR.value.grossVolume).toBe("10.00");
    expect(repR.value.counts.payments).toBe(1);
    await db.close();
  });

  it("excludes RECORD_ONLY commerce mirrors from revenue", async () => {
    const db = createDatabase({ enabled: false });
    await seedConfirmed(db, { amount: "25.00" }, {
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_ro",
    });
    // RECORD_ONLY mirror of an external "payment" — never revenue.
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
    const repR2 = await finReport(db);
    if (!repR2.ok) throw new Error("report failed");
    const rep = repR2.value;
    expect(rep.grossVolume).toBe("25.00");
    expect(rep.recordedOnly.count).toBe(1);
    expect(rep.recordedOnly.volume).toBe("1000.00");
    // net = 25 - stripe fee estimate (2.9% + 0.30 = 1.025)
    expect(rep.fees.stripeEstimated).toBe("1.025");
    await db.close();
  });

  it("splits gross by provider/product/network", async () => {
    const db = createDatabase({ enabled: false });
    await db.payments.products.upsert({
      id: "prod_a",
      code: "A",
      name: "A",
      description: null,
      category: "PASSPORT",
      active: true,
      payload: {},
    });
    const stripePay = await seedConfirmed(db, {
      amount: "10.00",
      productId: "prod_a",
    }, {
      provider: "STRIPE",
      network: "stripe",
      providerReference: "pi_report",
    });
    const usdcPay = mkPayment({
      status: "CONFIRMED",
      amount: "5.00",
      currency: "USDC",
    });
    await db.payments.payments.create(usdcPay);
    await db.payments.attempts.create(
      mkAttempt(usdcPay.id, {
        provider: "DIRECT_USDC",
        network: "eip155:1874",
        providerReference: null,
        status: "CONFIRMED",
        confirmedAtMs: Date.now(),
      }),
    );
    const repR3 = await finReport(db);
    if (!repR3.ok) throw new Error("report failed");
    const rep = repR3.value;
    expect(rep.byProvider["STRIPE"]).toBe("10.00");
    expect(rep.byProvider["DIRECT_USDC"]).toBe("5.00");
    expect(rep.byProduct["prod_a"]).toBe("10.00");
    expect(rep.byNetwork["eip155:1874"]).toBe("5.00");
    void stripePay;
    await db.close();
  });
});
