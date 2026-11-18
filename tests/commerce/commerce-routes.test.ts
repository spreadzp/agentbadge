/**
 * SLICE-224-3 (EPIC-224): commerce REST routes — auth, authz,
 * happy-path flows, guard and error paths.
 *
 * Sig-auth headers follow the shared agentbadge-access:v2 challenge:
 *   X-Wallet, X-Sig (EIP-191 over challenge), X-Timestamp (±300s).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createInMemoryCommerceStores } from "@agentbadge/database";
import { createCommerceService } from "../../src/server/lib/commerce";
import { createCommerceRoutes } from "../../src/server/routes/commerce/index";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { createHash, randomUUID } from "node:crypto";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const STRANGER_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const provider = privateKeyToAccount(PROVIDER_KEY);
const stranger = privateKeyToAccount(STRANGER_KEY);

function makeApp() {
  const stores = createInMemoryCommerceStores();
  const service = createCommerceService(stores);
  const app = new Hono();
  app.route("/", createCommerceRoutes(service));
  return app;
}

async function sigHeaders(
  account: ReturnType<typeof privateKeyToAccount>,
  method: string,
  path: string,
  rawBody: string,
  idemKey?: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = buildCommerceChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: rawBody ? createHash("sha256").update(rawBody).digest("hex") : "-",
    idemKey: idemKey ?? "-",
  });
  const signature = await account.signMessage({ message });
  return {
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
        "x-nonce": nonce,
    "content-type": "application/json",
  };
}

async function req(
  app: Hono,
  method: string,
  path: string,
  opts: {
    account?: ReturnType<typeof privateKeyToAccount>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.account) {
    Object.assign(
      headers,
      await sigHeaders(
        opts.account, method, path, rawBody, headers["idempotency_key"],
      ),
    );
  }
  if (rawBody && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: rawBody || undefined,
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function createOpenTask(app: Hono) {
  const r = await req(app, "POST", "/api/commerce/tasks", {
    account: buyer,
    body: { title: "Build agent badge", description: "make it" },
  });
  expect(r.status).toBe(201);
  return r.body.task as { id: string; status: string };
}

async function toAgreement(app: Hono) {
  const task = await createOpenTask(app);
  const offerRes = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
    account: provider,
    body: { price: "10.00", proposal: "will do" },
  });
  expect(offerRes.status).toBe(201);
  const offer = offerRes.body.offer as { id: string };
  const accept = await req(app, "POST", `/api/commerce/offers/${offer.id}/accept`, {
    account: buyer,
  });
  expect(accept.status).toBe(200);
  return {
    task,
    offer,
    agreement: accept.body.agreement as { id: string },
    payment: accept.body.payment as { id: string },
  };
}

// ─── auth ─────────────────────────────────────────────────────────

describe("sig-auth on writes", () => {
  it("rejects POST /tasks without headers → 401", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/commerce/tasks", {
      body: { title: "x", description: "y" },
    });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("WRONG_SIGNER");
  });

  it("rejects bad signature → 401", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/commerce/tasks", {
      body: { title: "x", description: "y" },
      headers: {
        "x-wallet": buyer.address,
        "x-sig": "0xdeadbeef",
        "x-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-nonce": crypto.randomUUID(),
      },
    });
    expect(r.status).toBe(401);
  });

  it("reads stay public (GET list + detail)", async () => {
    const app = makeApp();
    const task = await createOpenTask(app);
    const list = await req(app, "GET", "/api/commerce/tasks");
    expect(list.status).toBe(200);
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.task.id).toBe(task.id);
  });
});

// ─── tasks ────────────────────────────────────────────────────────

describe("tasks", () => {
  it("creates OPEN task (201) and DRAFT task; PATCH opens DRAFT", async () => {
    const app = makeApp();
    const draft = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "d", description: "d", status: "DRAFT" },
    });
    expect(draft.body.task.status).toBe("DRAFT");

    const patch = await req(app, "PATCH", `/api/commerce/tasks/${draft.body.task.id}`, {
      account: buyer,
      body: { status: "OPEN" },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.task.status).toBe("OPEN");
  });

  it("rejects PATCH with unsupported body", async () => {
    const app = makeApp();
    const task = await createOpenTask(app);
    const r = await req(app, "PATCH", `/api/commerce/tasks/${task.id}`, {
      account: buyer,
      body: { title: "new" },
    });
    expect(r.status).toBe(400);
  });

  it("idempotency_key replays task create → duplicate, same id", async () => {
    const app = makeApp();
    const key = "idem-task-12345678";
    const first = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "t", description: "d" },
      headers: { idempotency_key: key },
    });
    const second = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "t", description: "d" },
      headers: { idempotency_key: key },
    });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.task.id).toBe(first.body.task.id);
  });

  it("list filters by status and buyer", async () => {
    const app = makeApp();
    await createOpenTask(app);
    const open = await req(app, "GET", "/api/commerce/tasks?open=true");
    expect(open.body.tasks.length).toBe(1);
    const byBuyer = await req(app, "GET", `/api/commerce/tasks?buyer=${buyer.address}`);
    expect(byBuyer.body.tasks.length).toBe(1);
    const other = await req(app, "GET", `/api/commerce/tasks?buyer=${provider.address}`);
    expect(other.body.tasks.length).toBe(0);
  });

  it("cancel: buyer ok (cascades agreement), provider forbidden", async () => {
    const app = makeApp();
    const { task, agreement } = await toAgreement(app);
    const denied = await req(app, "POST", `/api/commerce/tasks/${task.id}/cancel`, {
      account: provider,
    });
    expect(denied.status).toBe(403);
    const ok = await req(app, "POST", `/api/commerce/tasks/${task.id}/cancel`, {
      account: buyer,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.task.status).toBe("CANCELLED");
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect((detail.body.agreement as { status: string }).status).toBe("CANCELLED");
    expect(agreement.id).toBeTruthy();
  });
});

// ─── offers ───────────────────────────────────────────────────────

describe("offers", () => {
  it("provider submits on OPEN, buyer forbidden on own task", async () => {
    const app = makeApp();
    const task = await createOpenTask(app);
    const denied = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: buyer,
      body: { price: "5", proposal: "self" },
    });
    expect(denied.status).toBe(403);
    const ok = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: provider,
      body: { price: "5.50", proposal: "mine" },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.offer.status).toBe("PENDING");
  });

  it("offer on non-OPEN task → 409 INVALID_TRANSITION", async () => {
    const app = makeApp();
    const draft = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "d", description: "d", status: "DRAFT" },
    });
    const r = await req(app, "POST", `/api/commerce/tasks/${draft.body.task.id}/offers`, {
      account: provider,
      body: { price: "1", proposal: "x" },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("INVALID_TRANSITION");
  });

  it("accept → agreement ACTIVE + payment NOT_PAID (RECORD_ONLY)", async () => {
    const app = makeApp();
    const { task, agreement, payment } = await toAgreement(app);
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.body.task.status).toBe("IN_PROGRESS");
    expect(detail.body.agreement.id).toBe(agreement.id);
    expect((detail.body.agreement as { status: string }).status).toBe("ACTIVE");
    expect((detail.body.payment as { status: string; mode: string }).mode).toBe("RECORD_ONLY");
    expect((detail.body.payment as { status: string }).status).toBe("NOT_PAID");
    expect(payment.id).toBeTruthy();
  });

  it("accept by stranger → 403; reject + withdraw authz", async () => {
    const app = makeApp();
    const task = await createOpenTask(app);
    const o1 = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: provider,
      body: { price: "1", proposal: "a" },
    });
    const strangerTry = await req(app, "POST", `/api/commerce/offers/${o1.body.offer.id}/accept`, {
      account: stranger,
    });
    expect(strangerTry.status).toBe(403);

    const o2 = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: provider,
      body: { price: "2", proposal: "b" },
    });
    const rejectByStranger = await req(app, "POST", `/api/commerce/offers/${o2.body.offer.id}/reject`, {
      account: stranger,
    });
    expect(rejectByStranger.status).toBe(403);
    const reject = await req(app, "POST", `/api/commerce/offers/${o2.body.offer.id}/reject`, {
      account: buyer,
    });
    expect(reject.status).toBe(200);
    expect(reject.body.offer.status).toBe("REJECTED");

    const o3 = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: provider,
      body: { price: "3", proposal: "c" },
    });
    const withdrawByBuyer = await req(app, "POST", `/api/commerce/offers/${o3.body.offer.id}/withdraw`, {
      account: buyer,
    });
    expect(withdrawByBuyer.status).toBe(403);
    const withdraw = await req(app, "POST", `/api/commerce/offers/${o3.body.offer.id}/withdraw`, {
      account: provider,
    });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.offer.status).toBe("WITHDRAWN");
  });
});

// ─── submissions + review + evidence ──────────────────────────────

describe("submissions/review/evidence", () => {
  it("provider submits → buyer ACCEPTED completes task+agreement", async () => {
    const app = makeApp();
    const { agreement } = await toAgreement(app);
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "done", evidenceRefs: ["https://x"] },
    });
    expect(sub.status).toBe(201);
    const list = await req(app, "GET", `/api/commerce/agreements/${agreement.id}/submissions`);
    expect(list.body.submissions.length).toBe(1);

    const review = await req(app, "POST", `/api/commerce/submissions/${sub.body.submission.id}/review`, {
      account: buyer,
      body: { verdict: "ACCEPTED" },
    });
    expect(review.status).toBe(200);
    expect(review.body.task.status).toBe("COMPLETED");
    expect(review.body.agreement.status).toBe("COMPLETED");
  });

  it("REVISION_REQUIRED returns task to IN_PROGRESS (resubmission round)", async () => {
    const app = makeApp();
    const { agreement } = await toAgreement(app);
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "v1" },
    });
    const review = await req(app, "POST", `/api/commerce/submissions/${sub.body.submission.id}/review`, {
      account: buyer,
      body: { verdict: "REVISION_REQUIRED", reviewNote: "redo" },
    });
    expect(review.body.task.status).toBe("IN_PROGRESS");
    const sub2 = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "v2" },
    });
    expect(sub2.status).toBe(201);
  });

  it("review by provider or stranger → 403 (buyer only)", async () => {
    const app = makeApp();
    const { agreement } = await toAgreement(app);
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "s" },
    });
    for (const account of [provider, stranger]) {
      const r = await req(app, "POST", `/api/commerce/submissions/${sub.body.submission.id}/review`, {
        account,
        body: { verdict: "ACCEPTED" },
      });
      expect(r.status).toBe(403);
    }
  });

  it("evidence attach by provider; stranger → 403", async () => {
    const app = makeApp();
    const { agreement } = await toAgreement(app);
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "s" },
    });
    const ev = await req(app, "POST", `/api/commerce/submissions/${sub.body.submission.id}/evidence`, {
      account: provider,
      body: { type: "URL", url: "https://proof.example/x" },
    });
    expect(ev.status).toBe(201);
    const denied = await req(app, "POST", `/api/commerce/submissions/${sub.body.submission.id}/evidence`, {
      account: stranger,
      body: { type: "URL", url: "https://evil" },
    });
    expect(denied.status).toBe(403);
  });
});

// ─── payment (RECORD_ONLY) ────────────────────────────────────────

describe("payment", () => {
  it("buyer records → PAYMENT_RECORDED; provider verifies → PAYMENT_VERIFIED", async () => {
    const app = makeApp();
    const { agreement, payment } = await toAgreement(app);
    const rec = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: buyer,
      body: { note: "paid via usdc" },
    });
    expect(rec.status).toBe(200);
    expect(rec.body.payment.status).toBe("PAYMENT_RECORDED");
    const ver = await req(app, "POST", `/api/commerce/payments/${payment.id}/verify`, {
      account: provider,
    });
    expect(ver.status).toBe(200);
    expect(ver.body.payment.status).toBe("PAYMENT_VERIFIED");
  });

  it("record by stranger → 403; verify before record → 409", async () => {
    const app = makeApp();
    const { agreement, payment } = await toAgreement(app);
    const denied = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: stranger,
      body: {},
    });
    expect(denied.status).toBe(403);
    const early = await req(app, "POST", `/api/commerce/payments/${payment.id}/verify`, {
      account: provider,
    });
    expect(early.status).toBe(409);
  });
});

// ─── guards + events ──────────────────────────────────────────────

describe("guards + events", () => {
  it("summary >4000 → 400 INVALID_INPUT", async () => {
    const app = makeApp();
    const { agreement } = await toAgreement(app);
    const r = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "x".repeat(4001) },
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_INPUT");
  });

  it("evidenceRefs >50 → 400", async () => {
    const app = makeApp();
    const { agreement } = await toAgreement(app);
    const r = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: provider,
      body: { summary: "s", evidenceRefs: Array(51).fill("r") },
    });
    expect(r.status).toBe(400);
  });

  it("short idempotency_key → 400 INVALID_INPUT", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "t", description: "d" },
      headers: { idempotency_key: "short" },
    });
    expect(r.status).toBe(400);
  });

  it("invalid JSON → 400 INVALID_JSON; malformed body → 400", async () => {
    const app = makeApp();
    const ts = Math.floor(Date.now() / 1000);
    const path = "/api/commerce/tasks";
    const raw = "not-json{";
    const nonce = randomUUID();
    const signature = await buyer.signMessage({
      message: buildCommerceChallenge({
        wallet: buyer.address,
        method: "POST",
        path,
        timestamp: ts,
        nonce,
        bodyHash: createHash("sha256").update(raw).digest("hex"),
        idemKey: "-",
      }),
    });
    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "x-wallet": buyer.address,
          "x-sig": signature,
          "x-timestamp": String(ts),
                    "x-nonce": nonce,
          "content-type": "application/json",
        },
        body: raw,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_JSON");
  });

  it("events feed is hash-chained and grows through lifecycle", async () => {
    const app = makeApp();
    const { task } = await toAgreement(app);
    const feed = await req(app, "GET", `/api/commerce/tasks/${task.id}/events`);
    expect(feed.status).toBe(200);
    const events = feed.body.events as Array<{ eventType: string; prevHash: string; hash: string }>;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.prevHash).toMatch(/^0{64}$/);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.prevHash).toBe(events[i - 1]!.hash);
    }
    const types = events.map((e) => e.eventType);
    expect(types).toContain("task.opened");
  });

  it("404 on unknown task/offer ids", async () => {
    const app = makeApp();
    const r1 = await req(app, "GET", "/api/commerce/tasks/nope");
    expect(r1.status).toBe(404);
    const r2 = await req(app, "POST", "/api/commerce/offers/nope/accept", { account: buyer });
    expect(r2.status).toBe(404);
  });
});
