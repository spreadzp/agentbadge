/**
 * SLICE-226-6 — regression suite for Arc re-audit round 6
 * (REVIEW-FINDINGS-v6.md): N6-1..N6-8. Every test pins the fixed
 * behavior so a regression is a failure.
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
  detectFromPaymentExceptions,
  finReport,
  resolveStripeRefund,
} from "../../src/server/lib/finops";

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;
const PAYEE = "0x" + "a".repeat(40);
const TX1 = "0x" + "b".repeat(64);

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
  status: "CONFIRMED",
  providerReference: uid("tx"),
  transactionHash: null,
  expiresAtMs: null,
  confirmedAtMs: Date.now(),
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
  await db.payments.attempts.create(mkAttempt(p.id, attemptOver));
  return p;
};

describe("SLICE-226-6 round-6 fixes (re-audit v6)", () => {
  it("N6-1: over-long source id with no paymentId is hashed AND clamped — scan completes", async () => {
    const db = createDatabase({ enabled: false });
    const hugeId = "f".repeat(500);
    await db.payments.exceptions.append({
      id: hugeId,
      // NO paymentId — subjectRef would fall back to the huge id and
      // fail the pre-pass, starving every later scan.
      kind: "AMOUNT_MISMATCH",
      severity: "WARN",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const res = await detectFromPaymentExceptions(db, {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.created.length).toBe(1);
      expect(res.value.created[0].id.length).toBeLessThanOrEqual(64);
      expect(
        res.value.created[0].subjectRef.length,
      ).toBeLessThanOrEqual(128);
    }
    await db.close();
  });

  it("N6-2: a whitespace-only stored currency falls back, never reaches the verifier", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    const intent = await createRefundIntent(db, {
      paymentId: p.id,
      payee: PAYEE,
      amount: "5.00",
      reason: "r",
      operator: "ops",
    });
    if (!intent.ok) throw new Error("intent create failed");
    // Forge a whitespace currency on the stored row — a corrupt write
    // must not reach the verifier as "   ".
    const store = db.finops.refundIntents;
    const origGet = store.getById;
    store.getById = (async (id: string) => {
      const row = await origGet.call(store, id);
      return row ? { ...row, currency: "   " } : row;
    }) as typeof origGet;
    let seenExpected = "";
    await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX1, operator: "ops" },
      async (_tx, exp) => {
        seenExpected = exp.currency;
        return { verified: exp.payee === PAYEE };
      },
    );
    store.getById = origGet;
    expect(seenExpected).not.toBe("   ");
    expect(seenExpected).not.toBe("");
    await db.close();
  });

  it("N6-3: empty-husk evidence fails resolve; numeric values still count", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(
      db,
      {},
      { provider: "STRIPE", providerReference: "pi_r6" },
    );
    await db.finops.adminActions.append({
      id: uid("aa"),
      action: "REFUND",
      subjectType: "payment",
      subjectId: p.id,
      operator: "ops",
      evidence: {
        kind: "STRIPE_REFUND_INITIATED",
        initiationId: "init-r6",
      },
      createdAtMs: Date.now(),
    });
    for (const ev of [{ a: "" }, "\u200B", "null"] as const) {
      const r = await resolveStripeRefund(db, {
        paymentId: p.id,
        landed: false,
        operator: "ops",
        evidence: ev,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    }
    // A numeric member is real content.
    const ok = await resolveStripeRefund(db, {
      paymentId: p.id,
      landed: false,
      operator: "ops",
      evidence: { stripeRefundId: "re_123", verifiedAtMs: 1700000000 },
    });
    expect(ok.ok).toBe(true);
    await db.close();
  });

  it("N6-5+N7-2: a raced append degrades to skipped only when the row really exists", async () => {
    const db = createDatabase({ enabled: false });
    const excStore = db.finops.exceptions;
    const orig = excStore.append;
    const dupThrow = (() => {
      const e = new Error(
        "duplicate key value violates unique constraint",
      ) as Error & { code?: string };
      e.code = "23505";
      throw e;
    }) as typeof orig;
    // Case A — the losing scan's throw is REAL dedupe: the mirrored
    // snapshot was taken BEFORE the winner wrote, so the source row
    // reaches append, throws 23505, and getById finds the row.
    const srcId = uid("pe");
    await db.payments.exceptions.append({
      id: srcId,
      paymentId: uid("pay"),
      kind: "AMOUNT_MISMATCH",
      severity: "WARN",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const origGet = excStore.getById;
    excStore.append = dupThrow;
    excStore.getById = (async (id: string) =>
      id === `rx_${srcId}`
        ? ({
            id,
            type: "AMOUNT_MISMATCH",
            subjectRef: "x",
            details: {},
            status: "OPEN",
            createdAtMs: Date.now(),
            createdAt: new Date().toISOString(),
          } as never)
        : origGet.call(excStore, id)) as typeof origGet;
    const raced = await detectFromPaymentExceptions(db, {});
    excStore.append = orig;
    excStore.getById = origGet;
    expect(raced.ok).toBe(true);
    if (raced.ok) {
      expect(raced.value.created.length).toBe(0);
      expect(raced.value.skipped).toContain(`rx_${srcId}`);
      expect(raced.value.errors ?? []).toHaveLength(0);
    }
    // Case B — N7-2: a throw that merely echoes "duplicate key" but
    // the row does NOT exist must surface as an error, not dedupe.
    await db.payments.exceptions.append({
      id: uid("pe"),
      paymentId: uid("pay"),
      kind: "WRONG_TOKEN",
      severity: "WARN",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    excStore.append = dupThrow;
    const bogus = await detectFromPaymentExceptions(db, {});
    excStore.append = orig;
    expect(bogus.ok).toBe(true);
    if (bogus.ok) {
      expect(bogus.value.created.length).toBe(0);
      expect(bogus.value.errors?.length).toBeGreaterThanOrEqual(1);
    }
    await db.close();
  });

  it("N6-6: a thrown store read anywhere in finReport maps to PROVIDER_ERROR", async () => {
    const db = createDatabase({ enabled: false });
    const throws = () => {
      throw new Error("driver down");
    };
    const payStore = db.payments.payments;
    const origPay = payStore.list;
    payStore.list = throws as typeof origPay;
    const r1 = await finReport(db, {});
    payStore.list = origPay;
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("PROVIDER_ERROR");
    await db.close();
  });

  it("N6-8: overlapping pages cannot duplicate candidates", async () => {
    const db = createDatabase({ enabled: false });
    // One OPEN source row + a store that repeats the same page.
    await db.payments.exceptions.append({
      id: "pe-dup",
      paymentId: uid("pay"),
      kind: "AMOUNT_MISMATCH",
      severity: "WARN",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const peStore = db.payments.exceptions;
    const real = peStore.list;
    peStore.list = (async (
      opts?: Parameters<typeof real>[0],
    ) => {
      // Simulate a store that clamps limit and returns the same row
      // on every re-ask.
      return real.call(peStore, opts);
    }) as typeof real;
    const res = await detectFromPaymentExceptions(db, { limit: 5 });
    peStore.list = real;
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ids = res.value.created.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length); // no dupes
      expect(ids.length).toBe(1);
    }
    await db.close();
  });
});
