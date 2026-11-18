/**
 * SLICE-226-3 — route-level tests for /admin/finance/*.
 * Fresh Hono app + injected in-memory Database + stubbed
 * VerifyRefundTx / StripeRefundClient — no chain, no Stripe calls.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createDatabase, type Database } from "@agentbadge/database";

import { createFinopsRoutes } from "../../src/server/routes/finops/finops";

const KEY = "test-admin-key";

let db: Database;
let app: Hono;
let verifyCalls = 0;
let stripeCalls = 0;

const auth = { "X-Admin-Key": KEY };
const PAYEE = "0x" + "a".repeat(40);
const TX1 = "0x" + "d".repeat(64);

const post = (
  path: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function seedPayment(
  overrides: Partial<Parameters<Database["payments"]["payments"]["create"]>[0]> = {},
  attemptOverrides: Partial<
    Parameters<Database["payments"]["attempts"]["create"]>[0]
  > = {},
) {
  const p = await db.payments.payments.create({
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    reference: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: "CONFIRMED",
    amount: "10.00",
    currency: "USD",
    purpose: "checkout",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    payload: {},
    ...overrides,
  });
  await db.payments.attempts.create({
    id: `att_${Math.random().toString(36).slice(2, 8)}`,
    paymentId: p!.id,
    provider: "DIRECT_USDC",
    providerReference: null,
    status: "CONFIRMED",
    amount: "10.00",
    currency: "USD",
    network: "eip155:5042002",
    transactionHash: "0xfeed",
    payload: {},
    ...attemptOverrides,
  });
  return p!;
}

beforeAll(() => {
  process.env.ADMIN_API_KEY = KEY;
});

beforeEach(() => {
  verifyCalls = 0;
  stripeCalls = 0;
  db = createDatabase({ enabled: false });
  app = new Hono();
  app.route(
    "/",
    createFinopsRoutes({
      getDb: () => db,
      verifyRefundTx: async () => {
        verifyCalls += 1;
        return { verified: true };
      },
      stripeClient: {
        refunds: {
          create: async () => {
            stripeCalls += 1;
            return { id: "re_test_1", status: "succeeded" };
          },
        },
      },
    }),
  );
});

describe("GET /admin/finance/* — auth + render", () => {
  it("401 without admin key", async () => {
    const res = await app.request("/admin/finance/payments");
    expect(res.status).toBe(401);
  });

  it("payments page renders rows", async () => {
    const p = await seedPayment();
    const res = await app.request("/admin/finance/payments", {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(p.reference);
    expect(text).toContain("Admin · Finance");
  });

  it("detail page renders payment + actions", async () => {
    const p = await seedPayment();
    const res = await app.request(`/admin/finance/payments/${p.id}`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(p.reference);
    expect(text).toContain("Retry verification");
  });

  it("detail 404s for unknown payment", async () => {
    const res = await app.request("/admin/finance/payments/nope", {
      headers: auth,
    });
    expect(res.status).toBe(404);
  });

  it("exceptions + audit + reports pages render", async () => {
    for (const path of [
      "/admin/finance/exceptions",
      "/admin/finance/audit",
      "/admin/finance/reports",
    ]) {
      const res = await app.request(path, { headers: auth });
      expect(res.status).toBe(200);
    }
  });

  it("reports ?format=csv exports csv", async () => {
    await seedPayment();
    const res = await app.request("/admin/finance/reports?format=csv", {
      headers: auth,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("grossVolume,10.00");
    expect(text).toContain('byProvider,"DIRECT_USDC"');
  });
});

describe("POST mutations — operator guards", () => {
  it("review without operator → 400", async () => {
    const p = await seedPayment();
    const res = await post(`/admin/finance/payments/${p.id}/review`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("OPERATOR_REQUIRED");
  });

  it("review with operator → AdminAction row", async () => {
    const p = await seedPayment();
    const res = await post(`/admin/finance/payments/${p.id}/review`, {
      operator: "jane.ops",
    });
    expect(res.status).toBe(200);
    const actions = await db.finops.adminActions.list({ operator: "jane.ops" });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("REVIEW");
  });

  it("refund intent mode creates OPEN intent", async () => {
    const p = await seedPayment();
    const res = await post(`/admin/finance/payments/${p.id}/refund`, {
      operator: "jane.ops",
      mode: "intent",
      payee: PAYEE,
      amount: "5.00",
      reason: "duplicate",
    });
    expect(res.status).toBe(201);
    const intents = await db.finops.refundIntents.list({});
    expect(intents).toHaveLength(1);
    expect(intents[0]!.status).toBe("OPEN");
  });

  it("refund stripe mode calls stripe client", async () => {
    const p = await seedPayment(
      {},
      {
        provider: "STRIPE",
        providerReference: "pi_test_123",
        network: null,
        transactionHash: null,
      },
    );
    const res = await post(`/admin/finance/payments/${p.id}/refund`, {
      operator: "jane.ops",
      mode: "stripe",
      reason: "duplicate",
    });
    expect(res.status).toBe(200);
    expect(stripeCalls).toBe(1);
    const updated = await db.payments.payments.getById(p.id);
    expect(updated!.status).toBe("REFUNDED");
  });

  it("refund intent complete verifies tx then completes", async () => {
    const p = await seedPayment();
    await post(`/admin/finance/payments/${p.id}/refund`, {
      operator: "ops",
      mode: "intent",
      payee: PAYEE,
      amount: "10.00",
      reason: "x",
    });
    const intent = (await db.finops.refundIntents.list({}))[0]!;
    const res = await post(`/admin/finance/refunds/${intent.id}/complete`, {
      operator: "ops",
      txHash: TX1,
    });
    expect(res.status).toBe(200);
    expect(verifyCalls).toBe(1);
    const updated = await db.finops.refundIntents.getById(intent.id);
    expect(updated!.status).toBe("COMPLETED");
    expect(updated!.txHash).toBe(TX1);
  });

  it("exceptions detect + resolve lifecycle", async () => {
    const scan = await post("/admin/finance/exceptions/detect", {
      operator: "ops",
    });
    expect(scan.status).toBe(200);
    // seed an exception directly, then resolve via route
    const exc = await db.finops.exceptions.append({
      id: "rx_1",
      type: "MISSING_TX",
      subjectRef: "pay_x",
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const res = await post(`/admin/finance/exceptions/${exc!.id}/resolve`, {
      operator: "ops",
      resolution: "IGNORED",
      note: "dup tx",
    });
    expect(res.status).toBe(200);
    const after = await db.finops.exceptions.getById(exc!.id);
    expect(after!.status).toBe("RESOLVED");
  });

  it("resolve rejects double-resolve (audit shows nothing happened)", async () => {
    const exc = await db.finops.exceptions.append({
      id: "rx_2",
      type: "ORPHAN_TX",
      subjectRef: "tx_y",
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    await post(`/admin/finance/exceptions/${exc!.id}/resolve`, {
      operator: "ops",
      resolution: "MATCHED",
    });
    const res = await post(`/admin/finance/exceptions/${exc!.id}/resolve`, {
      operator: "ops",
      resolution: "MATCHED",
    });
    // 226-6: domain INVALID_STATE maps to 409, not a blanket 400.
    expect(res.status).toBe(409);
  });

  it("mutations reject missing key", async () => {
    const res = await app.request("/admin/finance/exceptions/detect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});

describe("SLICE-226-6 hardening", () => {
  it("detect without operator creates nothing — no exceptions, no audit (C4)", async () => {
    await db.payments.exceptions.append({
      id: "pe_c4",
      paymentId: "pay_c4",
      kind: "DUPLICATE_TRANSFER",
      severity: "CRITICAL",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const res = await post("/admin/finance/exceptions/detect", {});
    expect(res.status).toBe(400);
    expect(await db.finops.exceptions.list({})).toHaveLength(0);
    expect(await db.finops.adminActions.list({})).toHaveLength(0);
  });

  it("detect audits as DETECT_EXCEPTIONS with created ids", async () => {
    await db.payments.exceptions.append({
      id: "pe_c4b",
      paymentId: "pay_c4b",
      kind: "DUPLICATE_TRANSFER",
      severity: "CRITICAL",
      details: {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    const res = await post("/admin/finance/exceptions/detect", {
      operator: "ops",
    });
    expect(res.status).toBe(200);
    const actions = await db.finops.adminActions.list({
      action: "DETECT_EXCEPTIONS",
    });
    expect(actions).toHaveLength(1);
    const ev = actions[0]!.evidence as {
      createdCount: number;
      createdIds: string[];
    };
    expect(ev.createdCount).toBe(1);
    expect(ev.createdIds).toEqual(["rx_pe_c4b"]);
  });

  it("stripe mode rejects a caller-supplied amount (H3)", async () => {
    const p = await seedPayment(
      {},
      {
        provider: "STRIPE",
        providerReference: "pi_amt",
        network: null,
        transactionHash: null,
      },
    );
    const res = await post(`/admin/finance/payments/${p.id}/refund`, {
      operator: "ops",
      mode: "stripe",
      amount: "1.00",
    });
    expect(res.status).toBe(400);
    expect(stripeCalls).toBe(0);
  });

  it("stripe refund sends an idempotency key (H3)", async () => {
    const p = await seedPayment(
      {},
      {
        provider: "STRIPE",
        providerReference: "pi_idem",
        network: null,
        transactionHash: null,
      },
    );
    let idem: string | undefined;
    const app2 = new Hono();
    app2.route(
      "/",
      createFinopsRoutes({
        getDb: () => db,
        verifyRefundTx: async () => ({ verified: true }),
        stripeClient: {
          refunds: {
            create: async (_input, opts) => {
              idem = opts?.idempotencyKey;
              return { id: "re_idem", status: "succeeded" };
            },
          },
        },
      }),
    );
    const res = await app2.request(`/admin/finance/payments/${p.id}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ operator: "ops", mode: "stripe" }),
    });
    expect(res.status).toBe(200);
    expect(idem).toBe(`refund:${p.id}`);
  });

  it("stripe refund reporting pending → 503, CONFIRMED kept, attempt audited (H3)", async () => {
    const p = await seedPayment(
      {},
      {
        provider: "STRIPE",
        providerReference: "pi_pend",
        network: null,
        transactionHash: null,
      },
    );
    const app2 = new Hono();
    app2.route(
      "/",
      createFinopsRoutes({
        getDb: () => db,
        verifyRefundTx: async () => ({ verified: true }),
        stripeClient: {
          refunds: {
            create: async () => ({ id: "re_pend", status: "pending" }),
          },
        },
      }),
    );
    const res = await app2.request(`/admin/finance/payments/${p.id}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ operator: "ops", mode: "stripe" }),
    });
    expect(res.status).toBe(503);
    expect((await db.payments.payments.getById(p.id))!.status).toBe(
      "CONFIRMED",
    );
    // INITIATED + terminal FAILED row (N4) — the failure closes the
    // in-flight lock and keeps the refund id on the trail.
    const refunds = await db.finops.adminActions.list({ action: "REFUND" });
    expect(refunds).toHaveLength(2);
    const kinds = refunds.map(
      (r) => (r.evidence as { kind: string }).kind,
    );
    expect(kinds).toContain("STRIPE_REFUND_INITIATED");
    expect(kinds).toContain("STRIPE_REFUND_FAILED");
    const failed = refunds.find(
      (r) => (r.evidence as { kind: string }).kind === "STRIPE_REFUND_FAILED",
    );
    expect(
      (failed!.evidence as { stripeRefundId: string }).stripeRefundId,
    ).toBe("re_pend");
  });

  it("txHash replay across intents → 409 TX_REUSED (C3)", async () => {
    const p1 = await seedPayment();
    const p2 = await seedPayment();
    for (const p of [p1, p2]) {
      await post(`/admin/finance/payments/${p.id}/refund`, {
        operator: "ops",
        mode: "intent",
        payee: PAYEE,
        amount: "10.00",
        reason: "r",
      });
    }
    const intents = await db.finops.refundIntents.list({});
    expect(intents).toHaveLength(2);
    const first = await post(`/admin/finance/refunds/${intents[0]!.id}/complete`, {
      operator: "ops",
      txHash: TX1,
    });
    expect(first.status).toBe(200);
    // Uppercase hex — normalizes to TX1, must replay-reject.
    const dup = await post(`/admin/finance/refunds/${intents[1]!.id}/complete`, {
      operator: "ops",
      txHash: `0x${"D".repeat(64)}`,
    });
    expect(dup.status).toBe(409);
    const body = (await dup.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TX_REUSED");
  });

  it("HTMX error fragment escapes error text — no HTML injection (M4)", async () => {
    const res = await app.request(
      "/admin/finance/payments/%3Cimg%20src=x%3E/refund",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "HX-Request": "true",
          ...auth,
        },
        body: JSON.stringify({
          operator: "ops",
          mode: "intent",
          payee: PAYEE,
          amount: "1.00",
          reason: "x",
        }),
      },
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("<img");
  });

  it("strict date params reject malformed values (M5)", async () => {
    for (const path of [
      "/admin/finance/reports?since=2025-02-31",
      "/admin/finance/reports?since=2025-13-01",
      "/admin/finance/reports?since=not-a-date",
      "/admin/finance/reports?since=2025-01-05&until=2025-01-01",
      "/admin/finance/payments?since=garbage",
    ]) {
      const res = await app.request(path, { headers: auth });
      expect(res.status).toBe(400);
    }
  });
});
