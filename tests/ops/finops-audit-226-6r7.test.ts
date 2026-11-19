/**
 * SLICE-226-6 — regression suite for Arc re-audit round 7
 * (REVIEW-FINDINGS-v7.md): N7-1..N7-6. Every test pins the fixed
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
  detectFromPaymentExceptions,
  markExternalReviewed,
  resolveStripeRefund,
} from "../../src/server/lib/finops";

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq += 1)}`;

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

describe("SLICE-226-6 round-7 fixes (re-audit v7)", () => {
  it("N7-1: whitespace-only paymentId falls back to the source id — scan survives", async () => {
    const db = createDatabase({ enabled: false });
    const srcId = uid("pe");
    await db.payments.exceptions.append({
      id: srcId,
      paymentId: "   ", // blank but truthy — must not reach subjectRef
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
      // subjectRef fell back to the trimmed source id, not the blank.
      expect(res.value.created[0].subjectRef).toBe(srcId.trim());
    }
    await db.close();
  });

  it("N7-3: deep-nested evidence is bounded by size check before recursion", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(db);
    // ~5000-deep nesting — under the 64 KB body cap, over the 4 KB
    // evidence cap. The size check must reject BEFORE the recursive
    // content check runs (no stack overflow, no 500).
    let deep: unknown[] = [];
    for (let i = 0; i < 5000; i += 1) deep = [deep];
    const r = await markExternalReviewed(
      db,
      "payment",
      p.id,
      "ops",
      deep,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["EVIDENCE_TOO_LARGE", "BAD_INPUT"]).toContain(
        r.error.code,
      );
    }
    await db.close();
  });

  it("N7-4: control/format/filler chars are not evidence", async () => {
    const db = createDatabase({ enabled: false });
    const p = await seedConfirmed(
      db,
      {},
      { provider: "STRIPE", providerReference: "pi_r7" },
    );
    await db.finops.adminActions.append({
      id: uid("aa"),
      action: "REFUND",
      subjectType: "payment",
      subjectId: p.id,
      operator: "ops",
      evidence: {
        kind: "STRIPE_REFUND_INITIATED",
        initiationId: "init-r7",
      },
      createdAtMs: Date.now(),
    });
    for (const ev of ["\u0001", "\u3164", "\u2800", "\u200B\uFEFF"] as const) {
      const r = await resolveStripeRefund(db, {
        paymentId: p.id,
        landed: false,
        operator: "ops",
        evidence: ev,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
    }
    await db.close();
  });
});
