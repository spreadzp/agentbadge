/**
 * SLICE-154-2 tests: POST /api/eaas/verdicts pipeline
 * (validate → rate-limit → x402 → issueVerdict), GET /:id, GET /:id/verify.
 *
 * Payment rail is mocked: `paymentForPrice` returns a middleware that emits
 * a 402 without `payment-signature`, settles otherwise and records the call
 * price. Asserts cover ordering (400 before pay, 429 before settle),
 * per-policy price, reject-on-policy-error, dedup and paymentTx persistence.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";

import { createEaasRoutes } from "../src/server/routes/eaas-api";
import { createVerdictSigner, hashDeliverable } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import type { PolicyFn } from "../src/server/lib/eaas/policies";
import type { PaymentMiddleware } from "../src/server/routes/identity";

const CHAIN_ID = 5042002;
const SIGNER_KEY = Wallet.createRandom().privateKey;
const signer = createVerdictSigner(SIGNER_KEY, CHAIN_ID);

const PAYER = "0x1111111111111111111111111111111111111111";
const PAY_TX = "0xabc123";

interface PayMock {
  calls: string[];
  middleware: (priceUsd: string) => PaymentMiddleware;
}

/** x402 mock: 402 without payment-signature, settles (sets ctx payment) with it. */
function makePayMock(): PayMock {
  const calls: string[] = [];
  const middleware = (priceUsd: string): PaymentMiddleware => {
    const mw = async (c: Context, next: Next) => {
      calls.push(priceUsd);
      if (!c.req.header("payment-signature")) {
        return c.json({ error: "payment required", price: priceUsd }, 402);
      }
      c.set("payment", { payer: PAYER, transaction: PAY_TX });
      return next();
    };
    return mw as PaymentMiddleware;
  };
  return { calls, middleware };
}

function makeApp(opts: {
  pay: PayMock;
  maxBytes?: number;
  rateRpm?: number;
  registry?: Record<string, PolicyFn>;
}) {
  const dir = mkdtempSync(join(tmpdir(), "eaas-api-"));
  const store = createJsonVerdictStore(join(dir, "v.json"));
  const app = new Hono();
  app.onError((e, c) => {
    console.error("eaas-api test error:", e);
    return c.json({ error: String(e) }, 500);
  });
  app.route(
    "/",
    createEaasRoutes({
      paymentForPrice: (priceUsd) => opts.pay.middleware(priceUsd),
      verdictUsd: "$0.01",
      scanUsd: "$0.05",
      maxBytes: opts.maxBytes ?? 1024,
      rateRpm: opts.rateRpm ?? 60,
      signer,
      store,
      ...(opts.registry ? { registry: opts.registry } : {}),
    }),
  );
  return { app, store, dir };
}

const post = (app: Hono, body: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/eaas/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const PAID = { "payment-signature": "sig" };

let dirs: string[] = [];
function mkApp(opts: Parameters<typeof makeApp>[0]) {
  const made = makeApp(opts);
  dirs.push(made.dir);
  return made;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("POST /api/eaas/verdicts", () => {
  it("402 when no payment header; middleware price = verdictUsd", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const res = await post(app, {
      policy: "deliverable-present",
      deliverable: { data: { a: 1 } },
    });
    expect(res.status).toBe(402);
    expect((await res.json()).price).toBe("$0.01");
    expect(pay.calls).toEqual(["$0.01"]);
  });

  it("200 with payment → signed artifact, verifyUrl, paymentTx persisted", async () => {
    const pay = makePayMock();
    const { app, store } = mkApp({ pay });
    const res = await post(
      app,
      { policy: "deliverable-present", deliverable: { data: { a: 1 } } },
      PAID,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.kind).toBe("approve");
    expect(body.artifact.evaluator).toBe(signer.address);
    expect(body.artifact.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    expect(body.verifyUrl).toBe(
      `/api/eaas/verdicts/${body.artifact.verdictId}/verify`,
    );
    const stored = store.get(body.artifact.verdictId);
    expect(stored?.paymentTx).toBe(PAY_TX);
    expect(stored?.consumerWallet).toBe(PAYER);
  });

  it("400 paths run BEFORE payment (no middleware call)", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const cases: [string, unknown][] = [
      ["bad json", "{oops"],
      ["no policy", { deliverable: { data: 1 } }],
      ["unknown policy", { policy: "nope", deliverable: { data: 1 } }],
      ["no deliverable", { policy: "deliverable-present" }],
      ["both fields", { policy: "deliverable-present", deliverable: { uri: "https://x.test", data: 1 } }],
      ["bad uri", { policy: "deliverable-present", deliverable: { uri: "ftp://x" } }],
      ["hash-match w/o expectedHash", { policy: "hash-match", deliverable: { data: 1 } }],
      ["bad expectedHash", { policy: "hash-match", deliverable: { data: 1 }, expectedHash: "0x1234" }],
    ];
    for (const [label, body] of cases) {
      const res = await post(app, body, PAID);
      expect(res.status, label).toBe(400);
    }
    expect(pay.calls).toEqual([]); // never charged
  });

  it("oversize deliverable.data → 400", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay, maxBytes: 16 });
    const res = await post(
      app,
      { policy: "deliverable-present", deliverable: { data: { big: "x".repeat(64) } } },
      PAID,
    );
    expect(res.status).toBe(400);
    expect(pay.calls).toEqual([]);
  });

  it("hash-match: wrong expectedHash → paid reject verdict", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const res = await post(
      app,
      {
        policy: "hash-match",
        deliverable: { data: { a: 1 } },
        expectedHash: ("0x" + "ff".repeat(32)) as Hex,
      },
      PAID,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.kind).toBe("reject");
    expect(body.artifact.reason).toBe("deliverable hash mismatch");
    // artifact commits to the real hash, not the supplied commitment
    expect(body.artifact.deliverableHash).toBe(
      hashDeliverable({ data: { a: 1 } }),
    );
  });

  it("policy throw → 200 reject verdict (fail-closed), payment still settled", async () => {
    const pay = makePayMock();
    const boom: PolicyFn = async () => {
      throw new Error("boom");
    };
    const { app } = mkApp({ pay, registry: { "always-boom": boom } });
    const res = await post(
      app,
      { policy: "always-boom", deliverable: { data: 1 } },
      PAID,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.kind).toBe("reject");
    expect(body.artifact.reason).toContain("evaluation-error");
    expect(pay.calls).toEqual(["$0.01"]);
  });

  it("readiness-scan uses scanUsd price override", async () => {
    const pay = makePayMock();
    const stub: PolicyFn = async () => ({
      pass: true,
      reason: "stub",
      evidence: null,
    });
    const { app } = mkApp({ pay, registry: { "readiness-scan": stub } });
    const res = await post(
      app,
      { policy: "readiness-scan", deliverable: { uri: "https://x.test" } },
      PAID,
    );
    expect(res.status).toBe(200);
    expect(pay.calls).toEqual(["$0.05"]);
  });

  it("dedup: same body + nonce → duplicate:true, single artifact", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const body = {
      policy: "deliverable-present",
      deliverable: { data: { a: 1 } },
      nonce: "n1",
    };
    const r1 = await post(app, body, PAID);
    const r2 = await post(app, body, PAID);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.duplicate).toBe(false);
    expect(b2.duplicate).toBe(true);
    expect(b2.artifact.verdictId).toBe(b1.artifact.verdictId);
  });

  it("429 when rpm exceeded — payment middleware not invoked", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay, rateRpm: 2 });
    const body = { policy: "deliverable-present", deliverable: { data: 1 }, nonce: "rl" };
    const wallet = { "x-wallet": "0xrl" };
    expect((await post(app, body, { ...PAID, ...wallet })).status).toBe(200);
    expect((await post(app, body, { ...PAID, ...wallet })).status).toBe(200);
    const res = await post(app, body, { ...PAID, ...wallet });
    expect(res.status).toBe(429);
    expect(pay.calls.length).toBe(2); // third request never reached payment
  });
});

describe("GET /api/eaas/verdicts/:verdictId", () => {
  it("returns stored verdict; 404 unknown; 400 malformed id", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const res = await post(
      app,
      { policy: "deliverable-present", deliverable: { data: 1 } },
      PAID,
    );
    const { artifact } = await res.json();

    const got = await app.request(`/api/eaas/verdicts/${artifact.verdictId}`);
    expect(got.status).toBe(200);
    expect((await got.json()).artifact.verdictId).toBe(artifact.verdictId);

    const missing = await app.request(`/api/eaas/verdicts/0x${"0".repeat(64)}`);
    expect(missing.status).toBe(404);

    const malformed = await app.request("/api/eaas/verdicts/nothex");
    expect(malformed.status).toBe(400);
  });
});

describe("GET /api/eaas/verdicts/:verdictId/verify", () => {
  it("returns valid:true for a stored artifact", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const res = await post(
      app,
      { policy: "deliverable-present", deliverable: { data: 1 } },
      PAID,
    );
    const { verifyUrl } = await res.json();
    const got = await app.request(verifyUrl);
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.valid).toBe(true);
    expect(body.signer).toBe(signer.address);
    expect(body.chainId).toBe(CHAIN_ID);
  });

  it("404 for unknown verdictId", async () => {
    const pay = makePayMock();
    const { app } = mkApp({ pay });
    const res = await app.request(
      `/api/eaas/verdicts/0x${"1".repeat(64)}/verify`,
    );
    expect(res.status).toBe(404);
  });
});
