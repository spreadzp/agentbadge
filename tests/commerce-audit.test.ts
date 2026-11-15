/**
 * SLICE-224-6: regression tests for the commerce audit findings.
 *
 *  C1 — offer acceptance atomicity (concurrent accepts: exactly one wins)
 *  C2 — submission/review state-graph preconditions before writes
 *  H1 — idempotency scoped to owner/resource/body fingerprint
 *  H2 — v2 signature binds body hash + nonce (tamper → 401, replay → 409)
 *  H3 — payment verification is provider/payee-only at the HTTP layer
 *  H4 — DRAFT privacy + payload redaction for non-parties
 *  H5 — agent identity claims are stored as unverified payload claims
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createInMemoryCommerceStores } from "@agentbadge/database";
import { createCommerceService } from "../src/server/lib/commerce";
import { createCommerceRoutes } from "../src/server/routes/commerce/index";
import { buildCommerceChallenge } from "../src/server/routes/commerce/shared";
import { createHash, randomUUID } from "node:crypto";

type Account = ReturnType<typeof privateKeyToAccount>;

// Anvil well-known fixtures — never real keys.
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_A_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const PROVIDER_B_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const providerA = privateKeyToAccount(PROVIDER_A_KEY);
const providerB = privateKeyToAccount(PROVIDER_B_KEY);

interface Row {
  id: string;
  status: string;
  [k: string]: unknown;
}

function makeApp() {
  const stores = createInMemoryCommerceStores();
  const service = createCommerceService(stores);
  const app = new Hono();
  app.route("/", createCommerceRoutes(service));
  return { app, stores };
}

async function sigHeaders(
  account: Account,
  method: string,
  path: string,
  rawBody: string,
  idemKey?: string,
  nonce = randomUUID(),
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
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
    account?: Account;
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

// ─── flow helpers ────────────────────────────────────────────────

async function createTask(app: Hono, body: Record<string, unknown> = {}) {
  const r = await req(app, "POST", "/api/commerce/tasks", {
    account: buyer,
    body: { title: "audit task", description: "d", ...body },
  });
  expect(r.status).toBe(201);
  return r.body.task as Row;
}

async function submitOffer(
  app: Hono,
  taskId: string,
  account: Account = providerA,
  body: Record<string, unknown> = {},
) {
  const r = await req(app, "POST", `/api/commerce/tasks/${taskId}/offers`, {
    account,
    body: { price: "9.50", proposal: "p", ...body },
  });
  expect(r.status).toBe(201);
  return r.body.offer as Row;
}

async function toAgreement(app: Hono) {
  const task = await createTask(app);
  const offer = await submitOffer(app, task.id);
  const accept = await req(app, "POST", `/api/commerce/offers/${offer.id}/accept`, {
    account: buyer,
  });
  expect(accept.status).toBe(200);
  return {
    task,
    offer,
    agreement: accept.body.agreement as Row,
    payment: accept.body.payment as Row,
  };
}

// ─── C1: atomic offer acceptance ─────────────────────────────────

describe("C1 — offer acceptance is atomic", () => {
  it("concurrent accepts: exactly one wins, exactly one agreement", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const o1 = await submitOffer(app, task.id, providerA);
    const o2 = await submitOffer(app, task.id, providerB);

    const [r1, r2] = await Promise.all([
      req(app, "POST", `/api/commerce/offers/${o1.id}/accept`, { account: buyer }),
      req(app, "POST", `/api/commerce/offers/${o2.id}/accept`, { account: buyer }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.body.agreement).not.toBeNull();
    expect(detail.body.task.status).toBe("IN_PROGRESS");

    // sibling PENDING offers are REJECTED — none left PENDING
    const offers = detail.body.offers as Row[];
    expect(offers.every((o) => o.status !== "PENDING")).toBe(true);
  });

  it("accept creates agreement + payment or neither (no partial writes)", async () => {
    const { app } = makeApp();
    const { task, agreement, payment } = await toAgreement(app);
    // both written in the same atomic callback — task detail shows both
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.body.agreement).toBeTruthy();
    expect(detail.body.payment).toBeTruthy();
    expect((detail.body.payment as Row).id).toBe(payment.id);
    expect(agreement.status).toBe("ACTIVE");
  });
});

// ─── C2: submission/review preconditions ─────────────────────────

describe("C2 — submission/review state preconditions", () => {
  it("submission on OPEN task (no agreement) → 4xx, nothing written", async () => {
    const { app, stores } = makeApp();
    await createTask(app);
    const r = await req(app, "POST", "/api/commerce/agreements/none/submissions", {
      account: providerA,
      body: { summary: "x" },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const subs = await stores.submissions.listByAgreement("none");
    expect(subs.length).toBe(0);
  });

  it("submit then review flips task UNDER_REVIEW → COMPLETED", async () => {
    const { app } = makeApp();
    const { task, agreement } = await toAgreement(app);
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "done", evidenceRefs: ["https://x"] },
    });
    expect(sub.status).toBe(201);
    const review = await req(
      app, "POST",
      `/api/commerce/submissions/${(sub.body.submission as Row).id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(review.status).toBe(200);
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.task.status).toBe("COMPLETED");
  });
});

// ─── H1: scoped idempotency ──────────────────────────────────────

describe("H1 — idempotency is scoped by owner/resource/body", () => {
  it("same key + different body → 409 CONFLICT", async () => {
    const { app } = makeApp();
    const key = "audit-idem-conflict";
    const first = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "a", description: "d" },
      headers: { idempotency_key: key },
    });
    expect(first.status).toBe(201);
    const conflict = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "different", description: "d" },
      headers: { idempotency_key: key },
    });
    expect(conflict.status).toBe(409);
  });

  it("same key + same body + different owner → independent 201", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const key = "audit-idem-owner-01";
    const body = { price: "9.50", proposal: "same" };
    const a = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: providerA, body, headers: { idempotency_key: key },
    });
    const b = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: providerB, body, headers: { idempotency_key: key },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201); // scoped by owner — not a duplicate
    expect((b.body.offer as Row).id).not.toBe((a.body.offer as Row).id);
  });

  it("same key on a different resource → independent writes", async () => {
    const { app } = makeApp();
    const t1 = await createTask(app);
    const t2 = await createTask(app);
    const key = "audit-idem-res-0001";
    const body = { price: "9.50", proposal: "x" };
    const a = await req(app, "POST", `/api/commerce/tasks/${t1.id}/offers`, {
      account: providerA, body, headers: { idempotency_key: key },
    });
    const b = await req(app, "POST", `/api/commerce/tasks/${t2.id}/offers`, {
      account: providerA, body, headers: { idempotency_key: key },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });
});

// ─── H2: body-bound signature + nonce replay ─────────────────────

describe("H2 — v2 signature binds body + nonce", () => {
  it("body tampered after signing → 401", async () => {
    const { app } = makeApp();
    const signed = JSON.stringify({ title: "signed", description: "d" });
    const headers = await sigHeaders(buyer, "POST", "/api/commerce/tasks", signed);
    // attacker swaps the body, keeping the signature
    const res = await app.fetch(
      new Request("http://localhost/api/commerce/tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "TAMPERED", description: "d" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("reusing a nonce → 409 replay", async () => {
    const { app } = makeApp();
    const nonce = randomUUID();
    const body = { title: "replay", description: "d" };
    const raw = JSON.stringify(body);
    const headers = await sigHeaders(buyer, "POST", "/api/commerce/tasks", raw, undefined, nonce);
    const first = await req(app, "POST", "/api/commerce/tasks", { body, headers });
    expect(first.status).toBe(201);
    // same signed request replayed (no idem key) → 409
    const replay = await req(app, "POST", "/api/commerce/tasks", { body, headers });
    expect(replay.status).toBe(409);
  });

  it("nonce-reused request WITH idem key → dedupe 200, not 409-replay", async () => {
    const { app } = makeApp();
    const key = "audit-idem-nonce-1";
    const body = { title: "idem retry", description: "d" };
    const headers = {
      ...(await sigHeaders(buyer, "POST", "/api/commerce/tasks", JSON.stringify(body), key)),
      idempotency_key: key,
    };
    const first = await req(app, "POST", "/api/commerce/tasks", { body, headers });
    const retry = await req(app, "POST", "/api/commerce/tasks", { body, headers });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
  });
});

// ─── H3: provider-only payment verify (HTTP layer) ───────────────

describe("H3 — payment verify restricted to provider", () => {
  it("buyer cannot verify own recorded payment → 403", async () => {
    const { app } = makeApp();
    const { agreement, payment } = await toAgreement(app);
    const rec = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: buyer,
      body: { amount: "9.50" },
    });
    expect(rec.status).toBe(200);
    const verify = await req(app, "POST", `/api/commerce/payments/${payment.id}/verify`, {
      account: buyer,
    });
    expect(verify.status).toBe(403);
    const ok = await req(app, "POST", `/api/commerce/payments/${payment.id}/verify`, {
      account: providerA,
    });
    expect(ok.status).toBe(200);
  });
});

// ─── H4: DRAFT privacy + redaction ───────────────────────────────

describe("H4 — DRAFT privacy + payload redaction", () => {
  it("DRAFT hidden from anonymous list/detail; visible to buyer", async () => {
    const { app } = makeApp();
    const draft = await createTask(app, { status: "DRAFT" });
    const anonDetail = await req(app, "GET", `/api/commerce/tasks/${draft.id}`);
    expect(anonDetail.status).toBe(404);
    const anonList = await req(app, "GET", "/api/commerce/tasks");
    expect((anonList.body.tasks as Row[]).some((t) => t.id === draft.id)).toBe(false);
    const buyerDetail = await req(app, "GET", `/api/commerce/tasks/${draft.id}`, {
      account: buyer,
    });
    expect(buyerDetail.status).toBe(200);
  });

  it("non-party sees payload:null; party sees payload", async () => {
    const { app } = makeApp();
    const task = await createTask(app, { payload: { secret: "buyer-ctx" } });
    const stranger = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: providerB,
    });
    expect(stranger.body.task.payload).toBeNull();
    const mine = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: buyer,
    });
    expect(mine.body.task.payload).toEqual({ secret: "buyer-ctx" });
  });

  // SLICE-224-7 BUG-1: Devin prod run found nested deliverable/payment
  // fields readable by non-parties on COMPLETED task detail.
  it("non-party detail: submissions+payment sensitive fields nulled", async () => {
    const { app } = makeApp();
    const task = await createTask(app, {});
    const offer = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: providerA,
      body: { price: "10.00", proposal: "ok" },
    });
    const accept = await req(
      app,
      "POST",
      `/api/commerce/offers/${(offer.body.offer as Row).id}/accept`,
      { account: buyer },
    );
    const agreement = accept.body.agreement as Row;
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "deliverable-secret", resultUrl: "https://x/y" },
    });
    await req(
      app,
      "POST",
      `/api/commerce/submissions/${(sub.body.submission as Row).id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED", reviewNote: "LGTM-secret" } },
    );
    await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: buyer,
      body: { paymentId: "pay-ref-secret", note: "manual wire note" },
    });

    const stranger = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: providerB,
    });
    expect(stranger.status).toBe(200);
    const s0 = (stranger.body.submissions as Row[])[0];
    expect(s0.summary).toBeNull();
    expect(s0.resultUrl).toBeNull();
    expect(s0.reviewNote).toBeNull();
    const pay = stranger.body.payment as Row;
    expect(pay.note).toBeNull();
    expect(pay.paymentId).toBeNull();
    expect(pay.recordedBy).toBeNull();

    const mine = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: buyer,
    });
    expect((mine.body.submissions as Row[])[0].summary).toBe("deliverable-secret");
    expect((mine.body.payment as Row).paymentId).toBe("pay-ref-secret");
  });
});

// ─── H5: unverified agent identity ───────────────────────────────

describe("H5 — agent identity is a claim, not verified identity", () => {
  it("buyerAgentId lands in payload.claimed*, row field stays null", async () => {
    const { app } = makeApp();
    const r = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "t", description: "d", buyerAgentId: "agent-42" },
    });
    expect(r.status).toBe(201);
    expect(r.body.task.buyerAgentId).toBeNull();
    expect((r.body.task.payload as Record<string, unknown>).claimedBuyerAgentId).toBe("agent-42");
  });

  it("providerAgentId lands in payload.claimed*, row field stays null", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const r = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: providerA,
      body: { price: "9.50", proposal: "p", providerAgentId: "agent-99" },
    });
    expect(r.status).toBe(201);
    expect(r.body.offer.providerAgentId).toBeNull();
    expect((r.body.offer.payload as Record<string, unknown>).claimedProviderAgentId).toBe("agent-99");
  });
});
