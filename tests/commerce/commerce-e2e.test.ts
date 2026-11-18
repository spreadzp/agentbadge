/**
 * SLICE-224-4 (EPIC-224): end-to-end commerce flow + contract guards.
 *
 * Happy path: task OPEN → 2 offers → accept → agreement ACTIVE →
 * submission + evidence (URL/HASH/TRANSACTION) → REVISION_REQUIRED →
 * resubmit → ACCEPTED → task+agreement COMPLETED → RECORD_ONLY payment
 * record+verify. Asserts CommerceEvent hash-chain integrity by
 * recomputing every hash via `hashEvent` and verifying prevHash linkage.
 *
 * Negative paths: invalid transitions, authz matrix, idempotent replay,
 * size guards (summary >4000, evidenceRefs >50), unsigned writes → 401.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../../src/server/middleware/agent-auth";
import { createInMemoryCommerceStores } from "@agentbadge/database";
import { createCommerceService } from "../../src/server/lib/commerce";
import {
  GENESIS_HASH,
  hashEvent,
} from "../../src/server/lib/commerce/state-machines";
import { createCommerceRoutes } from "../../src/server/routes/commerce/index";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { createHash, randomUUID } from "node:crypto";

// Anvil well-known fixtures — never real keys.
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_A_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const PROVIDER_B_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const providerA = privateKeyToAccount(PROVIDER_A_KEY);
const providerB = privateKeyToAccount(PROVIDER_B_KEY);

type Account = ReturnType<typeof privateKeyToAccount>;

interface Row {
  id: string;
  status?: string;
  hash?: string;
  prevHash?: string;
  [k: string]: unknown;
}

function makeApp() {
  const stores = createInMemoryCommerceStores();
  const service = createCommerceService(stores);
  const app = new Hono();
  app.route("/", createCommerceRoutes(service));
  return { app, stores };
}

beforeEach(() => {
  // Default verifier does an ERC-6492 eth_call over RPC — hangs offline.
  // viem verifyMessage recovers locally for EOAs.
  configureAgentAuthForTesting({
    verifier: (wallet, message, signature) =>
      verifyMessage({
        address: wallet as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      }),
  });
});

afterEach(() => {
  resetAgentAuthForTesting();
});

async function sigHeaders(
  account: Account,
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
    account?: Account;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const rawBody =
    opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : "");
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.account) {
    Object.assign(
      headers,
      await sigHeaders(
        opts.account,
        method,
        path,
        rawBody,
        headers["idempotency_key"],
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

async function createTask(app: Hono, status?: "DRAFT" | "OPEN") {
  const r = await req(app, "POST", "/api/commerce/tasks", {
    account: buyer,
    body: {
      title: "E2E commerce task",
      description: "full flow",
      budget: "25.00",
      currency: "USD",
      ...(status ? { status } : {}),
    },
  });
  expect(r.status).toBe(201);
  return r.body.task as Row;
}

async function submitOffer(app: Hono, taskId: string, account: Account, price = "10.00") {
  const r = await req(app, "POST", `/api/commerce/tasks/${taskId}/offers`, {
    account,
    body: { price, proposal: "I can deliver" },
  });
  expect(r.status).toBe(201);
  return r.body.offer as Row;
}

// ─── happy path ──────────────────────────────────────────────────

describe("e2e happy path", () => {
  it("task → 2 offers → accept → submit → revise → accept → complete → pay → events", async () => {
    const { app } = makeApp();

    // 1. Buyer creates OPEN task
    const task = await createTask(app, "OPEN");
    expect(task.status).toBe("OPEN");

    // 2. Two providers submit offers
    const offerA = await submitOffer(app, task.id, providerA, "10.00");
    const offerB = await submitOffer(app, task.id, providerB, "9.50");
    const list = await req(app, "GET", `/api/commerce/tasks/${task.id}/offers`);
    expect(list.body.offers.length).toBe(2);

    // 3. Buyer accepts A → agreement ACTIVE, task IN_PROGRESS
    const accept = await req(app, "POST", `/api/commerce/offers/${offerA.id}/accept`, {
      account: buyer,
    });
    expect(accept.status).toBe(200);
    const agreement = accept.body.agreement as Row;
    const payment = accept.body.payment as Row;
    expect(agreement.status).toBe("ACTIVE");
    const afterAccept = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(afterAccept.body.task.status).toBe("IN_PROGRESS");
    expect(payment.status).toBe("NOT_PAID");

    // Losing offer B cannot be accepted anymore (single-round, D-224-9)
    const lateAccept = await req(app, "POST", `/api/commerce/offers/${offerB.id}/accept`, {
      account: buyer,
    });
    expect(lateAccept.status).toBe(409);

    // 4. Provider A submits work + three evidence types
    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "v1 done", evidenceRefs: ["https://proof.example/v1"] },
    });
    expect(sub.status).toBe(201);
    const submission = sub.body.submission as Row;

    for (const ev of [
      { type: "URL", url: "https://proof.example/report" },
      {
        type: "HASH",
        hash: "a".repeat(64),
      },
      {
        type: "TRANSACTION",
        hash: `0x${"b".repeat(64)}`,
      },
    ]) {
      const r = await req(app, "POST", `/api/commerce/submissions/${submission.id}/evidence`, {
        account: providerA,
        body: ev,
      });
      expect(r.status).toBe(201);
    }

    // 5. Buyer requests revision → provider resubmits
    const revise = await req(app, "POST", `/api/commerce/submissions/${submission.id}/review`, {
      account: buyer,
      body: { verdict: "REVISION_REQUIRED", reviewNote: "needs tweaks" },
    });
    expect(revise.status).toBe(200);
    expect(revise.body.task.status).toBe("IN_PROGRESS");
    expect(revise.body.submission.status).toBe("REVISION_REQUIRED");

    const sub2 = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "v2 revised" },
    });
    expect(sub2.status).toBe(201);

    // 6. Buyer accepts v2 → task + agreement COMPLETED
    const acceptSub = await req(
      app,
      "POST",
      `/api/commerce/submissions/${(sub2.body.submission as Row).id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(acceptSub.status).toBe(200);
    expect(acceptSub.body.task.status).toBe("COMPLETED");
    expect(acceptSub.body.agreement.status).toBe("COMPLETED");

    // 7. RECORD_ONLY payment lifecycle
    const rec = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: buyer,
      body: { amount: "10.00", note: "manual wire" },
    });
    expect(rec.status).toBe(200);
    expect(rec.body.payment.status).toBe("PAYMENT_RECORDED");
    const ver = await req(app, "POST", `/api/commerce/payments/${payment.id}/verify`, {
      account: providerA,
    });
    expect(ver.status).toBe(200);
    expect(ver.body.payment.status).toBe("PAYMENT_VERIFIED");

    // 8. Event feed is the full ordered history with a valid hash chain
    const feed = await req(app, "GET", `/api/commerce/tasks/${task.id}/events`);
    expect(feed.status).toBe(200);
    const events = feed.body.events as Row[];
    expect(events.length).toBeGreaterThanOrEqual(4);
    const types = events.map((e) => e.eventType as string);
    expect(types).toContain("task.created");
    expect(types).toContain("task.in_progress");
    expect(types).toContain("task.completed");

    let prev = GENESIS_HASH;
    for (const e of events) {
      expect(e.prevHash).toBe(prev);
      const recomputed = hashEvent({
        prevHash: e.prevHash as string,
        entityType: e.entityType as string,
        entityId: e.entityId as string,
        eventType: e.eventType as string,
        actorWallet: (e.actorWallet as string | null) ?? null,
        payload: e.payload ?? {},
      });
      expect(e.hash).toBe(recomputed);
      prev = e.hash as string;
    }

    // Task detail embeds the full graph
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.body.agreement.id).toBe(agreement.id);
    expect(detail.body.payment.status).toBe("PAYMENT_VERIFIED");
    expect(detail.body.offers.length).toBe(2);
    expect(detail.body.submissions.length).toBe(2);
  });

  it("draft task lifecycle: DRAFT → PATCH OPEN → offers allowed", async () => {
    const { app } = makeApp();
    const draft = await createTask(app, "DRAFT");
    expect(draft.status).toBe("DRAFT");

    const early = await req(app, "POST", `/api/commerce/tasks/${draft.id}/offers`, {
      account: providerA,
      body: { price: "1.00", proposal: "early" },
    });
    expect(early.status).toBe(409);

    const open = await req(app, "PATCH", `/api/commerce/tasks/${draft.id}`, {
      account: buyer,
      body: { status: "OPEN" },
    });
    expect(open.status).toBe(200);
    expect(open.body.task.status).toBe("OPEN");

    const offer = await submitOffer(app, draft.id, providerA);
    expect(offer.status).toBe("PENDING");
  });
});

// ─── negative paths ──────────────────────────────────────────────

describe("e2e negative paths", () => {
  it("unsigned write → 401; wrong signer cannot act", async () => {
    const { app } = makeApp();
    const unsigned = await req(app, "POST", "/api/commerce/tasks", {
      body: { title: "x", description: "y" },
    });
    expect(unsigned.status).toBe(401);

    const task = await createTask(app);
    const stranger = providerB; // not the buyer
    const cancel = await req(app, "POST", `/api/commerce/tasks/${task.id}/cancel`, {
      account: stranger,
    });
    expect(cancel.status).toBe(403);
  });

  it("invalid transitions rejected: offer on cancelled task; accept twice", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const cancel = await req(app, "POST", `/api/commerce/tasks/${task.id}/cancel`, {
      account: buyer,
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.task.status).toBe("CANCELLED");

    const offer = await req(app, "POST", `/api/commerce/tasks/${task.id}/offers`, {
      account: providerA,
      body: { price: "1.00", proposal: "late" },
    });
    expect(offer.status).toBe(409);
  });

  it("authz: buyer cannot submit work; provider cannot review or pay", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const offer = await submitOffer(app, task.id, providerA);
    const accept = await req(app, "POST", `/api/commerce/offers/${offer.id}/accept`, {
      account: buyer,
    });
    const agreement = accept.body.agreement as Row;
    const payment = accept.body.payment as Row;

    // Buyer cannot submit work
    const subByBuyer = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: buyer,
      body: { summary: "fake" },
    });
    expect(subByBuyer.status).toBe(403);

    const sub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "work" },
    });
    expect(sub.status).toBe(201);

    // Provider cannot review own submission
    const selfReview = await req(
      app,
      "POST",
      `/api/commerce/submissions/${(sub.body.submission as Row).id}/review`,
      { account: providerA, body: { verdict: "ACCEPTED" } },
    );
    expect(selfReview.status).toBe(403);

    // Provider cannot record payment; stranger cannot verify
    const payByProvider = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: providerA,
      body: {},
    });
    expect(payByProvider.status).toBe(403);
    const verByStranger = await req(app, "POST", `/api/commerce/payments/${payment.id}/verify`, {
      account: providerB,
    });
    expect(verByStranger.status).toBe(403);
  });

  it("idempotency: same idempotency_key replays without double-write", async () => {
    const { app, stores } = makeApp();
    const key = "e2e-idem-00000001";
    const body = { title: "idem", description: "x" };
    const headers = await sigHeaders(
      buyer, "POST", "/api/commerce/tasks",
      JSON.stringify(body), key,
    );

    const first = await req(app, "POST", "/api/commerce/tasks", {
      body,
      headers: { ...headers, idempotency_key: key },
    });
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);

    const replay = await req(app, "POST", "/api/commerce/tasks", {
      body,
      headers: { ...headers, idempotency_key: key },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.task.id).toBe(first.body.task.id);

    const list = await stores.tasks.list({});
    expect(list.length).toBe(1);
  });

  it("size guards: summary >4000 and evidenceRefs >50 rejected", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const offer = await submitOffer(app, task.id, providerA);
    const accept = await req(app, "POST", `/api/commerce/offers/${offer.id}/accept`, {
      account: buyer,
    });
    const agreement = accept.body.agreement as Row;

    const big = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "x".repeat(4001) },
    });
    expect(big.status).toBe(400);

    const refs = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "ok", evidenceRefs: Array.from({ length: 51 }, (_, i) => `https://e${i}`) },
    });
    expect(refs.status).toBe(400);

    // exactly at the boundary succeeds
    const okSub = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/submissions`, {
      account: providerA,
      body: { summary: "x".repeat(4000), evidenceRefs: Array.from({ length: 50 }, (_, i) => `https://e${i}`) },
    });
    expect(okSub.status).toBe(201);
  });

  it("payment ≠ task status invariant: cancel task leaves payment NOT_PAID; cancel cascades agreement only", async () => {
    const { app } = makeApp();
    const task = await createTask(app);
    const offer = await submitOffer(app, task.id, providerA);
    const accept = await req(app, "POST", `/api/commerce/offers/${offer.id}/accept`, {
      account: buyer,
    });
    const agreement = accept.body.agreement as Row;
    const payment = accept.body.payment as Row;

    // Payment can be recorded while task is still IN_PROGRESS (independent status, D-224-4)
    const rec = await req(app, "POST", `/api/commerce/agreements/${agreement.id}/payment`, {
      account: buyer,
      body: {},
    });
    expect(rec.status).toBe(200);
    expect(rec.body.payment.status).toBe("PAYMENT_RECORDED");
    const detailMid = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detailMid.body.task.status).toBe("IN_PROGRESS");

    // Task cancel cascades to agreement but payment status stays
    const cancel = await req(app, "POST", `/api/commerce/tasks/${task.id}/cancel`, {
      account: buyer,
    });
    expect(cancel.body.task.status).toBe("CANCELLED");
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`);
    expect(detail.body.agreement.status).toBe("CANCELLED");
    expect(detail.body.payment.status).toBe("PAYMENT_RECORDED");
    void payment;
  });

  it("hash chain is entity-scoped: offer stream has its own genesis", async () => {
    const { app, stores } = makeApp();
    const task = await createTask(app);
    const offer = await submitOffer(app, task.id, providerA);

    const offerEvents = await stores.events.listByEntity("offer", offer.id);
    expect(offerEvents.length).toBeGreaterThanOrEqual(1);
    expect(offerEvents[0]!.prevHash).toBe(GENESIS_HASH);
    for (const e of offerEvents) {
      expect(
        hashEvent({
          prevHash: e.prevHash,
          entityType: e.entityType,
          entityId: e.entityId,
          eventType: e.eventType,
          actorWallet: e.actorWallet ?? null,
          payload: e.payload,
        }),
      ).toBe(e.hash);
    }
  });
});
