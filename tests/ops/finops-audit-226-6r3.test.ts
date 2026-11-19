/**
 * SLICE-226-6 — regression suite for Arc re-audit round 3
 * (REVIEW-FINDINGS-v3.md): M-1..M-8 plus verified lows.
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
  createRefundIntent,
  detectFromPaymentExceptions,
  recordAdminAction,
  recordPostEffectAudit,
  reviewPayment,
  stripeRefund,
  sumDecimals,
} from "../../src/server/lib/finops";

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;
const PAYEE = "0x" + "a".repeat(40);

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

const openException = (id: string) => ({
  id,
  paymentId: uid("src"),
  kind: "ORPHAN_TX",
  severity: "WARN",
  status: "OPEN",
  createdAtMs: Date.now(),
});

describe("SLICE-226-6 round-3 fixes (re-audit v3)", () => {
  it("M-1: intent asset binds to the settled attempt currency, not the USD label", async () => {
    const db = createDatabase({ enabled: false });
    // Denomination USD, settled in USDC — the only sane case in prod.
    const p = await seedConfirmed(db, { currency: "USD" }, { currency: "USDC" });
    const ok = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops", currency: "USDC",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.currency).toBe("USDC");
    // Passing the denomination is now explicitly wrong.
    const wrong = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "1.00",
      reason: "r", operator: "ops", currency: "USD",
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("BAD_INPUT");
    await db.close();
  });

  it("M-5: intents require ALL confirmed attempts on-chain; zero confirmed rejects", async () => {
    const db = createDatabase({ enabled: false });
    // Mixed settlement: on-chain + a second Stripe capture — must not
    // refund manually (double pay path).
    const mixed = await seedConfirmed(db);
    await db.payments.attempts.create(mkAttempt(mixed.id, {
      provider: "STRIPE", status: "CONFIRMED",
      providerReference: "pi_dup", transactionHash: null,
    }));
    const i1 = await createRefundIntent(db, {
      paymentId: mixed.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    expect(i1.ok).toBe(false);
    if (!i1.ok) expect(i1.error.code).toBe("INVALID_STATE");
    // No confirmed attempt at all — payment flipped, attempt lagged.
    const bare = mkPayment({ status: "CONFIRMED" });
    await db.payments.payments.create(bare);
    await db.payments.attempts.create(mkAttempt(bare.id, { status: "PENDING" }));
    const i2 = await createRefundIntent(db, {
      paymentId: bare.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    expect(i2.ok).toBe(false);
    if (!i2.ok) expect(i2.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("M-6: caller-kind REVIEW rows cannot spoof or clear the stripe lock", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    // A forged INITIATED on a REVIEW row must NOT create a lock.
    await reviewPayment(db, p.id, "ops", { kind: "STRIPE_REFUND_INITIATED" });
    const i1 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    expect(i1.ok).toBe(true);
    // A real REFUND INITIATED locks; a forged FAILED on REVIEW does
    // NOT release it (lock pairing is by initiationId, REFUND-only).
    await recordAdminAction(db, {
      action: "REFUND", subjectType: "payment", subjectId: p.id,
      operator: "ops",
      evidence: { kind: "STRIPE_REFUND_INITIATED", initiationId: "x1" },
    });
    await reviewPayment(db, p.id, "ops", { kind: "STRIPE_REFUND_FAILED" });
    const i2 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "1.00",
      reason: "r", operator: "ops",
    });
    expect(i2.ok).toBe(false);
    // A terminal row with a DIFFERENT initiationId also keeps the lock.
    await recordAdminAction(db, {
      action: "REFUND", subjectType: "payment", subjectId: p.id,
      operator: "ops",
      evidence: { kind: "STRIPE_REFUND_FAILED", initiationId: "other" },
    });
    const i3 = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "1.00",
      reason: "r", operator: "ops",
    });
    expect(i3.ok).toBe(false);
    await db.close();
  });

  it("M-7: stripe path refuses non-confirmed attempt fallback + non-pi_ refs", async () => {
    const db = createDatabase({ enabled: false });
    const stripe = { refunds: { create: async () => ({ id: "re_x", status: "succeeded" }) } };
    // On-chain settled + abandoned STRIPE attempt with a reference —
    // the old fallback would have refunded an unrelated PaymentIntent.
    const p = await seedConfirmed(db);
    await db.payments.attempts.create(mkAttempt(p.id, {
      provider: "STRIPE", status: "ABANDONED",
      providerReference: "pi_abandoned", transactionHash: null,
    }));
    const r1 = await stripeRefund(db, { paymentId: p.id, operator: "ops" }, stripe);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("INVALID_STATE");
    // CONFIRMED stripe attempt whose reference is a session id.
    const p2 = await seedConfirmed(db, {}, {
      provider: "STRIPE", providerReference: "cs_test_123",
      transactionHash: null,
    });
    const r2 = await stripeRefund(db, { paymentId: p2.id, operator: "ops" }, stripe);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("M-2: control-char reason is serialized-capped; post-effect audit degrades", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, {}, {
      provider: "STRIPE", providerReference: "pi_m2",
      transactionHash: null,
    });
    const r = await stripeRefund(
      db,
      { paymentId: p.id, operator: "ops", reason: "\x01".repeat(512) },
      { refunds: { create: async () => ({ id: "re_m2", status: "succeeded" }) } },
    );
    // 512 raw control chars → ~3074 serialized — rejected up front.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    // The post-effect helper itself: an overflowing row is retried
    // with minimal evidence and carries a `degraded` marker — an
    // effect that already landed is never unaudited.
    const row = await recordPostEffectAudit(
      db,
      {
        action: "REFUND",
        subjectType: "payment",
        subjectId: p.id,
        operator: "ops",
        evidence: { kind: "STRIPE_REFUND", blob: "x".repeat(8000) },
      },
      { kind: "STRIPE_REFUND", stripeRefundId: "re_min" },
    );
    expect(row.ok).toBe(true);
    if (row.ok) {
      const e = row.value.evidence as Record<string, unknown>;
      expect(e.degraded).toBe(true);
      expect(e.stripeRefundId).toBe("re_min");
    }
    await db.close();
  });

  it("M-4: a 150-row backlog is fully mirrored across two scans", async () => {
    const db = createDatabase({ enabled: false });
    for (let i = 0; i < 150; i += 1) {
      await db.payments.exceptions.append(openException(`pe_${i}`));
    }
    const s1 = await detectFromPaymentExceptions(db, { limit: 100 });
    const s2 = await detectFromPaymentExceptions(db, { limit: 100 });
    expect(s1.ok && s2.ok).toBe(true);
    if (s1.ok && s2.ok) {
      // No starvation — the second scan reaches past the mirrored
      // window instead of re-reading the same first 100.
      expect(s1.value.created.length + s2.value.created.length).toBe(150);
    }
    const rows = await db.finops.exceptions.list({});
    expect(rows.length).toBe(150);
    await db.close();
  });

  it("M-3: 100 uuid-suffixed created ids fit the byte-budgeted audit row", async () => {
    const db = createDatabase({ enabled: false });
    for (let i = 0; i < 100; i += 1) {
      await db.payments.exceptions.append(
        openException(`pe_${crypto.randomUUID()}`),
      );
    }
    const res = await detectFromPaymentExceptions(db, { limit: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.created.length).toBe(100);
    // The route's idSample(1200) is what keeps this bounded; a
    // post-effect degraded row would still carry the counts.
    await db.close();
  });

  it("M-8: sumDecimals throws on malformed amounts — no silent skip", async () => {
    expect(() => sumDecimals(["10.00", "0x10", "5.00"])).toThrow();
    expect(() => sumDecimals(["10.00", "100.000000000000000000000000000000"])).toThrow();
    expect(sumDecimals(["10.00", "5.000000"])).toBe("15.00");
    // Canonical DB reads (trailing zeros) still sum.
    expect(sumDecimals(["1.000000", "2.50"])).toBe("3.50");
  });

  it("L-9: operator labels need a letter or digit — mark-only rejected", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    const r = await reviewPayment(db, p.id, "\u0301\u0302");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("OPERATOR_REQUIRED");
    await db.close();
  });
});
