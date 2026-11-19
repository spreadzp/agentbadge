/**
 * EPIC-226 / SLICE-226-6 — Arc-audit fix regressions (bugbook).
 *
 * One test per Critical/High finding from REVIEW-FINDINGS.md:
 *   C1 audit-before-intent ordering, C2 cumulative cap, C3 txHash
 *   uniqueness, C4b prototype-safe lookup, H1 meaningful evidence,
 *   H4 verifier fact checks, H5 operator normalization,
 *   H6 windowed refund totals, M7 amount cap.
 *
 * Extracted from finops.test.ts (file-size limit). Same harness:
 * in-memory Database (createDatabase({enabled:false})).
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
  detectFromPaymentExceptions,
  finReport,
  listAdminActions,
  markExternalReviewed,
  recordAdminAction,
  reviewPayment,
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

describe("SLICE-226-6 audit fixes", () => {
  it("C1: oversized reason rejects before any effect — no unaudited intent", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const r = await createRefundIntent(db, {
      paymentId: p.id,
      payee: PAYEE,
      amount: "5.00",
      reason: "x".repeat(600),
      operator: "ops",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    // The C1 attack: intent must NOT exist (guard ran before create).
    expect(await db.finops.refundIntents.listByPayment(p.id)).toHaveLength(0);
    expect(await db.finops.adminActions.list({})).toHaveLength(0);
    await db.close();
  });

  it("C2: cumulative cap — a second full intent is rejected", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const a = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "10.00",
      reason: "r", operator: "ops",
    });
    expect(a.ok).toBe(true);
    // 100% already reserved by the OPEN intent.
    const b = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE_B, amount: "0.01",
      reason: "r", operator: "ops",
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.code).toBe("INVALID_STATE");
    // Partial split that fits: 6 + 4 = 10 on a fresh payment.
    const p2 = await seedConfirmed(db, { amount: "10.00" });
    for (const amt of ["6.00", "4.00"]) {
      const r = await createRefundIntent(db, {
        paymentId: p2.id, payee: PAYEE, amount: amt,
        reason: "r", operator: "ops",
      });
      expect(r.ok).toBe(true);
    }
    const over = await createRefundIntent(db, {
      paymentId: p2.id, payee: PAYEE, amount: "0.01",
      reason: "r", operator: "ops",
    });
    expect(over.ok).toBe(false);
    await db.close();
  });

  it("C3: one tx binds one intent — replay + case variant rejected", async () => {
    const db = createDatabase({ enabled: false });
    const p1 = await seedConfirmed(db, { amount: "5.00" });
    const p2 = await seedConfirmed(db, { amount: "5.00" });
    const verify = async () => ({ verified: true });
    const i1 = await createRefundIntent(db, {
      paymentId: p1.id, payee: PAYEE, amount: "5.00",
      reason: "r", operator: "ops",
    });
    const i2 = await createRefundIntent(db, {
      paymentId: p2.id, payee: PAYEE_B, amount: "5.00",
      reason: "r", operator: "ops",
    });
    if (!i1.ok || !i2.ok) throw new Error("intent create failed");
    const first = await completeRefundIntent(
      db, { intentId: i1.value.id, txHash: TX1, operator: "ops" }, verify,
    );
    expect(first.ok).toBe(true);
    // Replay the same tx (uppercase hex variant — normalizes to TX1).
    const dup = await completeRefundIntent(
      db, { intentId: i2.value.id, txHash: `0x${"D".repeat(64)}`, operator: "ops" },
      verify,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("TX_REUSED");
    // A distinct real tx still completes i2.
    const second = await completeRefundIntent(
      db, { intentId: i2.value.id, txHash: TX2, operator: "ops" }, verify,
    );
    expect(second.ok).toBe(true);
    await db.close();
  });

  it("H4: verified:true is not enough — self-payment + asset mismatch rejected", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "10.00",
      reason: "r", operator: "ops",
    });
    if (!i.ok) throw new Error("intent create failed");
    // Verifier says the sender IS the payee — self-transfer, not a payout.
    const selfPay = await completeRefundIntent(
      db, { intentId: i.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: true, payer: PAYEE }),
    );
    expect(selfPay.ok).toBe(false);
    if (!selfPay.ok) expect(selfPay.error.code).toBe("TX_UNVERIFIED");
    // Wrong asset — payment is USD; USDC-looking tx doesn't count.
    const wrongAsset = await completeRefundIntent(
      db, { intentId: i.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: true, asset: "EUR" }),
    );
    expect(wrongAsset.ok).toBe(false);
    if (!wrongAsset.ok) expect(wrongAsset.error.code).toBe("TX_UNVERIFIED");
    // The verifier receives the full expectation — asset + notBefore.
    let seen: { currency?: string; notBeforeMs?: number } = {};
    await completeRefundIntent(
      db, { intentId: i.value.id, txHash: TX1, operator: "ops" },
      async (_h, exp) => {
        seen = { currency: exp.currency, notBeforeMs: exp.notBeforeMs };
        return { verified: true };
      },
    );
    expect(seen.currency).toBe("USD");
    // N11: 1s tolerance — block timestamps are second-granular.
    expect(seen.notBeforeMs).toBe(i.value.createdAtMs - 1000);
    await db.close();
  });

  it("H5: operator normalized — zero-width stripped, 64-char cap", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    await reviewPayment(db, p.id, "  ops\u200B.alice  ");
    await reviewPayment(db, p.id, "x".repeat(100));
    const rows = (await listAdminActions(db)).sort(
      (a, b) => a.createdAtMs - b.createdAtMs,
    );
    expect(rows[0]!.operator).toBe("ops.alice");
    expect(rows[1]!.operator).toBe("x".repeat(64));
    await db.close();
  });

  it("H6: refunds completed outside the report window are excluded", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const i = await createRefundIntent(db, {
      paymentId: p.id, payee: PAYEE, amount: "4.00",
      reason: "r", operator: "ops",
    });
    if (!i.ok) throw new Error("intent create failed");
    const done = await completeRefundIntent(
      db, { intentId: i.value.id, txHash: TX1, operator: "ops" },
      async () => ({ verified: true }),
    );
    if (!done.ok) throw new Error("complete failed");
    const full = await finReport(db);
    if (!full.ok) throw new Error("report failed");
    expect(full.value.refundsTotal).toBe("4.00");
    // Window ending before the completion — refund is not this period's.
    const past = await finReport(db, {
      untilMs: (done.value.completedAtMs ?? 0) - 1000,
    });
    if (!past.ok) throw new Error("report failed");
    expect(past.value.refundsTotal).toBe("0.00");
    await db.close();
  });

  it("H1: markExternalReviewed requires meaningful evidence + known subject", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    for (const ev of [{}, "   ", [], null, undefined, 0, false]) {
      const r = await markExternalReviewed(db, "payment", p.id, "ops", ev);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    }
    const good = await markExternalReviewed(db, "payment", p.id, "ops", {
      url: "https://evidence.example/1",
    });
    expect(good.ok).toBe(true);
    const badType = await markExternalReviewed(
      db, "whatever", "x", "ops", { u: 1 },
    );
    expect(badType.ok).toBe(false);
    await db.close();
  });

  it("C4b: prototype-polluting exception kinds fall back safely", async () => {
    const db = createDatabase({ enabled: false });
    for (const [id, kind] of [
      ["pe_ctor", "constructor"],
      ["pe_proto", "__proto__"],
      ["pe_tostr", "toString"],
    ] as const) {
      await db.payments.exceptions.append({
        id,
        paymentId: `pay_${id}`,
        kind,
        severity: "WARN",
        details: {},
        status: "OPEN",
        createdAtMs: Date.now(),
      });
    }
    const r = await detectFromPaymentExceptions(db);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.created).toHaveLength(3);
      expect(r.value.created.every((c) => c.type === "AMOUNT_MISMATCH")).toBe(true);
    }
    await db.close();
  });

  it("audit writer rejects actions outside the ADMIN_ACTIONS vocabulary", async () => {
    const db = createDatabase({ enabled: false });
    const r = await recordAdminAction(db, {
      action: "POISON",
      subjectType: "payment",
      subjectId: "pay_x",
      operator: "ops",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    await db.close();
  });

  it("M7: pathological decimal strings are rejected", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db, { amount: "10.00" });
    const r = await createRefundIntent(db, {
      paymentId: p.id,
      payee: PAYEE,
      amount: "1".repeat(10_000),
      reason: "r",
      operator: "ops",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    await db.close();
  });
});
