/**
 * SLICE-181-2 tests: two-phase settle seam + self-settle refund.
 *
 * AC coverage:
 *  1. refuse on a seam route → 4xx, router.settle NOT called (exact rail)
 *  2. self-settled refusal → refund_log record + refund.status in response
 *  3. commit() after refuse() → error (state machine)
 *  4. atomic createSettleSeam regression — unchanged behaviour
 *  5. REFUND_AUTO_ENABLED off → status:"pending", no refund tx attempt
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type {
  PaymentRequirements,
  PaymentRouter,
} from "@agentbadge/circle-payments";

import {
  createSettleSeam,
  createSettleSeamTwoPhase,
  SeamStateError,
  type PaymentHandle,
} from "../src/server/lib/x402-settle-seam";
import {
  createMemoryRefundLog,
  createRefundService,
  type RefundRecord,
} from "../src/server/lib/refund-log";

const SELF_SETTLE_SCHEME = "eip3009-client-broadcast";
const PAYER = "0x2222222222222222222222222222222222222222";
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ARC_REQ: PaymentRequirements = {
  scheme: SELF_SETTLE_SCHEME,
  network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "1000000",
  payTo: "0x9999999999999999999999999999999999999999",
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: SELF_SETTLE_SCHEME },
} as PaymentRequirements;
const EXACT_REQ: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "1000000",
  payTo: "0x9999999999999999999999999999999999999999",
  maxTimeoutSeconds: 60,
} as PaymentRequirements;

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64");

const selfSettlePayload = b64({
  x402Version: 2,
  accepted: ARC_REQ,
  payload: { txHash: TX },
});
const exactPayload = b64({
  x402Version: 2,
  accepted: EXACT_REQ,
  payload: { signature: "0xsig", authorization: {} },
});

interface MockRouter {
  router: PaymentRouter;
  calls: { verify: number; settle: number };
}
function mockRouter(over: Partial<PaymentRouter> = {}): MockRouter {
  const calls = { verify: 0, settle: 0 };
  const router = {
    acceptsFor: () => [ARC_REQ, EXACT_REQ],
    verify: async () => {
      calls.verify++;
      return { isValid: true, payer: PAYER };
    },
    settle: async () => {
      calls.settle++;
      return { success: true, transaction: TX, payer: PAYER };
    },
    ...over,
  } as unknown as PaymentRouter;
  return { router, calls };
}

type Mode = "refuse" | "commit" | "refuse-then-commit" | "commit-then-refuse";

function appWith(
  mode: Mode,
  opts: {
    router: PaymentRouter;
    refunds?: ReturnType<typeof createRefundService>;
    capture?: (h: PaymentHandle) => void;
  },
): Hono {
  const app = new Hono();
  const seam = createSettleSeamTwoPhase({
    router: opts.router,
    amountAtomic: () => "1000000",
    description: "test paid route",
    ...(opts.refunds ? { refunds: opts.refunds } : {}),
  });
  app.post("/work", async (c) => {
    const h = await seam(c);
    if (!h) return c.json({ error: "payment required" }, 402);
    opts.capture?.(h);
    switch (mode) {
      case "refuse":
        return h.refuse("policy_refusal", "job not submittable");
      case "commit": {
        const r = await h.commit();
        return c.json({ payer: r.payer, tx: r.tx });
      }
      case "refuse-then-commit": {
        h.refuse("policy_refusal", "nope");
        try {
          await h.commit();
          return c.json({ error: "commit should have thrown" }, 500);
        } catch (e) {
          if (e instanceof SeamStateError) {
            return c.json({ refused: true }, 200);
          }
          throw e;
        }
      }
      case "commit-then-refuse": {
        await h.commit();
        try {
          h.refuse("policy_refusal", "too late");
          return c.json({ error: "refuse should have thrown" }, 500);
        } catch (e) {
          if (e instanceof SeamStateError) {
            return c.json({ committed: true }, 200);
          }
          throw e;
        }
      }
    }
  });
  return app;
}

const post = (app: Hono, header?: string) =>
  app.request("/work", {
    method: "POST",
    headers: header ? { "payment-signature": header } : {},
  });

describe("createSettleSeamTwoPhase", () => {
  it("no payment-signature → null + PAYMENT-REQUIRED stamped, no router calls", async () => {
    const { router, calls } = mockRouter();
    const res = await post(appWith("commit", { router }));
    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    expect(calls).toEqual({ verify: 0, settle: 0 });
  });

  it("refuse on exact rail → 409 policy_refusal, charged:false, settle NOT called (AC1)", async () => {
    const { router, calls } = mockRouter();
    const res = await post(appWith("refuse", { router }), exactPayload);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("policy_refusal");
    expect(body.charged).toBe(false);
    expect(calls.verify).toBe(1);
    expect(calls.settle).toBe(0);
  });

  it("commit on exact rail → settle called once, result returned", async () => {
    const { router, calls } = mockRouter();
    const res = await post(appWith("commit", { router }), exactPayload);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payer).toBe(PAYER);
    expect(body.tx).toBe(TX);
    expect(calls).toEqual({ verify: 1, settle: 1 });
  });

  it("commit() after refuse() → SeamStateError (AC3)", async () => {
    const { router, calls } = mockRouter();
    const res = await post(
      appWith("refuse-then-commit", { router }),
      exactPayload,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refused: true });
    expect(calls.settle).toBe(0);
  });

  it("refuse() after commit() → SeamStateError", async () => {
    const { router } = mockRouter();
    const res = await post(
      appWith("commit-then-refuse", { router }),
      exactPayload,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ committed: true });
  });

  it("self-settled payment surfaces selfSettled.tx on the handle", async () => {
    const { router } = mockRouter();
    let seen: PaymentHandle | undefined;
    const res = await post(
      appWith("commit", { router, capture: (h) => (seen = h) }),
      selfSettlePayload,
    );
    expect(res.status).toBe(200);
    expect(seen?.selfSettled).toEqual({ tx: TX });
    expect(seen?.payer).toBe(PAYER);
  });
});

describe("self-settled refusal → refund path (AC2, AC5)", () => {
  const service = (
    send?: (rec: RefundRecord) => Promise<`0x${string}`>,
    enabled = true,
  ) => {
    const log = createMemoryRefundLog();
    const svc = createRefundService({
      log,
      autoEnabled: () => enabled,
      ...(send ? { send } : {}),
    });
    return { log, svc };
  };

  it("REFUND_AUTO_ENABLED off → refund.status pending, no send attempt (AC5)", async () => {
    let sent = 0;
    const { log, svc } = service(async () => {
      sent++;
      return "0xrefund" as `0x${string}`;
    }, false);
    const { router, calls } = mockRouter();
    const res = await post(
      appWith("refuse", { router, refunds: svc }),
      selfSettlePayload,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.charged).toBe(false);
    expect(body.refund).toMatchObject({ status: "pending" });
    expect(calls.settle).toBe(0);
    expect(sent).toBe(0);
    const recs = log.list();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      payer: PAYER,
      amountAtomic: "1000000",
      paymentTx: TX,
      status: "pending",
      reason: "job not submittable",
    });
  });

  it("flag on + sender → auto-refund attempted, record transitions to sent (AC2)", async () => {
    const sentTo: RefundRecord[] = [];
    const { log, svc } = service(async (rec) => {
      sentTo.push(rec);
      return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    });
    const { router } = mockRouter();
    const res = await post(
      appWith("refuse", { router, refunds: svc }),
      selfSettlePayload,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.refund?.status).toBeDefined();
    await expect
      .poll(() => log.list()[0]?.status, { timeout: 1000 })
      .toBe("sent");
    expect(sentTo).toHaveLength(1);
    expect(log.list()[0]?.refundTx).toBe(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  it("flag on + sender throws → record failed", async () => {
    const { log, svc } = service(async () => {
      throw new Error("rpc down");
    });
    const { router } = mockRouter();
    const res = await post(
      appWith("refuse", { router, refunds: svc }),
      selfSettlePayload,
    );
    expect(res.status).toBe(409);
    await expect
      .poll(() => log.list()[0]?.status, { timeout: 1000 })
      .toBe("failed");
  });

  it("exact-rail refusal → no refund record (nothing to refund)", async () => {
    const { log, svc } = service(async () => "0xcc" as `0x${string}`);
    const { router } = mockRouter();
    const res = await post(
      appWith("refuse", { router, refunds: svc }),
      exactPayload,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.refund).toBeUndefined();
    expect(log.list()).toHaveLength(0);
  });
});

describe("refund-log store", () => {
  it("recordRefund assigns id + createdAt + pending status", () => {
    const log = createMemoryRefundLog();
    const svc = createRefundService({ log, autoEnabled: () => false });
    const rec = svc.recordRefund({
      payer: PAYER,
      amountAtomic: "1000000",
      paymentTx: TX,
      reason: "test",
    });
    expect(rec.id).toBeTruthy();
    expect(rec.status).toBe("pending");
    expect(rec.createdAt).toBeTruthy();
    expect(log.get(rec.id)).toEqual(rec);
  });
});

describe("atomic seam regression (AC4)", () => {
  it("createSettleSeam still does verify+settle atomically", async () => {
    const { router, calls } = mockRouter();
    const seam = createSettleSeam({
      router,
      amountAtomic: () => "1000000",
    });
    const app = new Hono();
    app.post("/atomic", async (c) => {
      const r = await seam(c);
      if (!r) return c.json({ error: "payment required" }, 402);
      return c.json({ payer: r.payer, tx: r.tx });
    });
    const res = await app.request("/atomic", {
      method: "POST",
      headers: { "payment-signature": exactPayload },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ payer: PAYER, tx: TX });
    expect(calls).toEqual({ verify: 1, settle: 1 });
  });
});
