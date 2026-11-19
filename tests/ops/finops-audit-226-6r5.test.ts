/**
 * SLICE-226-6 — regression suite for Arc re-audit round 5
 * (REVIEW-FINDINGS-v5.md): N5-1..N5-7. Every test pins the fixed
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
import { withLock } from "../../src/server/lib/finops/payment-mutex";

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;
const PAYEE = "0x" + "a".repeat(40);
const TX1 = "0x" + "f".repeat(64);

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
  await db.payments.attempts.create(
    mkAttempt(p.id, attemptOver),
  );
  return p;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SLICE-226-6 round-5 fixes (re-audit v5)", () => {
  it("N5-1: a timed-out waiter stays in the chain — no caller runs concurrent with the holder", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let maxActive = 0;
    let active = 0;
    const probe = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await new Promise<string>((r) =>
          setTimeout(() => r("done"), 60),
        );
      } finally {
        active -= 1;
      }
    };
    // Wedge the lock, then a waiter that times out while the holder
    // is still running, then a third caller that must serialize.
    const t1 = withLock("pay", "n5-1", () => held, 5_000);
    await sleep(20); // holder is running
    const timedOut = withLock("pay", "n5-1", probe, 60);
    // Attach the rejection expectation NOW — the timeout fires at
    // ~60ms while `release` only comes at ~140ms; a late-attached
    // handler trips the unhandled-rejection reporter.
    const timedOutRejects = expect(timedOut).rejects.toThrowError();
    const waited = withLock("pay", "n5-1", probe, 5_000);
    setTimeout(release, 140); // holder outlives the 60ms wait
    await t1;
    await timedOutRejects;
    await expect(waited).resolves.toBe("done");
    expect(maxActive).toBe(1);
    // After the chain drains the lock works again.
    await expect(
      withLock("pay", "n5-1", async () => "again", 500),
    ).resolves.toBe("again");
  });

  it("N5-2: a null/blank attempt currency is INVALID_STATE, not a 500 or a weakened cross-check", async () => {
    const db = createDatabase({ enabled: false });
    const nullCur = await seedConfirmed(
      db,
      {},
      { currency: null as unknown as string },
    );
    const res = await createRefundIntent(db, {
      paymentId: nullCur.id,
      payee: PAYEE,
      amount: "5.00",
      reason: "r",
      operator: "ops",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_STATE");
    await db.close();
  });

  it("N5-3: resolveStripeRefund requires MEANINGFUL evidence, not just bounded size", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(
      db,
      {},
      { provider: "STRIPE", providerReference: "pi_r5" },
    );
    // Open an initiation row so resolution is reachable at all.
    await db.finops.adminActions.append({
      id: uid("aa"),
      action: "REFUND",
      subjectType: "payment",
      subjectId: p.id,
      operator: "ops",
      evidence: {
        kind: "STRIPE_REFUND_INITIATED",
        initiationId: "init-1",
      },
      createdAtMs: Date.now(),
    });
    const res = await resolveStripeRefund(db, {
      paymentId: p.id,
      landed: true,
      operator: "ops",
      evidence: {}, // bounded but meaningless
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("BAD_INPUT");
    await db.close();
  });

  it("N5-4: a thrown payment flip is flagged needsReconcile, not swallowed", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(
      db,
      {},
      { provider: "STRIPE", providerReference: "pi_r5" },
    );
    await db.finops.adminActions.append({
      id: uid("aa"),
      action: "REFUND",
      subjectType: "payment",
      subjectId: p.id,
      operator: "ops",
      evidence: {
        kind: "STRIPE_REFUND_INITIATED",
        initiationId: "init-2",
      },
      createdAtMs: Date.now(),
    });
    const orig = db.payments.payments.applyStatus;
    db.payments.payments.applyStatus = () => {
      throw new Error("store down");
    };
    const res = await resolveStripeRefund(db, {
      paymentId: p.id,
      landed: true,
      operator: "ops",
      evidence: { stripeDashboard: "checked re_abc exists" },
    });
    db.payments.payments.applyStatus = orig;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.paymentFlip).toBe(false);
      expect(res.value.needsReconcile).toBe(true);
    }
    // Initiation still closed with a terminal row carrying the flag.
    const rows = await db.finops.adminActions.listBySubject(
      "payment",
      p.id,
    );
    const terminal = rows.find(
      (a) =>
        (a.evidence as { resolvedManually?: boolean })
          .resolvedManually === true,
    );
    expect(
      (terminal?.evidence as { needsReconcile?: boolean })
        .needsReconcile,
    ).toBe(true);
    await db.close();
  });

  it("N5-5: a corrupt intent row 400s the report instead of 500ing; undated COMPLETED intent is surfaced", async () => {
    const db = createDatabase({ enabled: false });
    await seedConfirmed(db);
    const orig = db.finops.refundIntents.list;
    db.finops.refundIntents.list = () => {
      throw new Error("dec(): malformed decimal");
    };
    const rep = await finReport(db, { sinceMs: 0, untilMs: Date.now() });
    db.finops.refundIntents.list = orig;
    expect(rep.ok).toBe(false);
    if (!rep.ok) expect(rep.error.code).toBe("PROVIDER_ERROR");
    // COMPLETED row without completedAtMs → surfaced, not dropped.
    // Forge it via a store stub — the write path can never emit one.
    const realList = db.finops.refundIntents.list;
    db.finops.refundIntents.list = (async () => [
      {
        id: uid("ri"),
        paymentId: "x",
        payee: PAYEE,
        amount: "1.00",
        currency: "USDC",
        reason: "r",
        status: "COMPLETED",
        txHash: TX1,
        operator: "ops",
        createdAtMs: Date.now(),
        completedAtMs: null,
      },
    ]) as typeof realList;
    const rep2 = await finReport(db, { sinceMs: 0, untilMs: Date.now() });
    db.finops.refundIntents.list = realList;
    expect(rep2.ok).toBe(false);
    if (!rep2.ok) {
      expect(rep2.error.code).toBe("PROVIDER_ERROR");
      expect(rep2.error.message).toContain("completedAtMs");
    }
    await db.close();
  });

  it("N5-6: a thrown complete() pairs INTENT_COMPLETING with an abort marker on the payment subject", async () => {
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
    const orig = db.finops.refundIntents.complete;
    db.finops.refundIntents.complete = () => {
      throw new Error("store down");
    };
    const done = await completeRefundIntent(
      db,
      { intentId: intent.value.id, txHash: TX1, operator: "ops" },
      async (_tx, exp) => ({ verified: exp.payee === PAYEE }),
    );
    db.finops.refundIntents.complete = orig;
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.error.code).toBe("PROVIDER_ERROR");
    const rows = await db.finops.adminActions.listBySubject(
      "payment",
      p.id,
    );
    const kinds = rows.map(
      (a) => (a.evidence as { kind?: string }).kind,
    );
    expect(kinds).toContain("INTENT_COMPLETING");
    expect(kinds).toContain("INTENT_COMPLETE_ABORTED");
    await db.close();
  });

  it("N5-7: an over-long source id is hashed — the batch does not starve", async () => {
    const db = createDatabase({ enabled: false });
    const hugeId = "e".repeat(500);
    await db.payments.exceptions.append({
      id: hugeId,
      paymentId: uid("pay"),
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
      expect(res.value.created[0].id.startsWith("rx_")).toBe(true);
      expect(res.value.created[0].id.length).toBeLessThanOrEqual(64);
    }
    await db.close();
  });
});
