/**
 * SLICE-227-5 (EPIC-227): commerce → settlement wiring.
 *
 * - accept offer → auto MilestonePlan (agreementRef = agreement.id,
 *   default single "full" milestone = agreedAmount)
 * - maxProviders: task accepts up to N providers; quota fill
 *   auto-rejects leftover PENDING offers; over-quota accept → 409
 * - submission.milestoneRef → milestone READY; buyer ACCEPTED →
 *   milestone APPROVED + PayoutIntent OPEN with provider leg
 * - task COMPLETED only when ALL agreements COMPLETED
 * - task detail embeds agreements[] with settlementRef
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../../src/server/middleware/agent-auth";
import { createDatabase, type Database } from "@agentbadge/database";
import { createCommerceService } from "../../src/server/lib/commerce";
import { createCommerceSettlementBridge } from "../../src/server/lib/commerce/settlement-bridge";
import {
  createSettlementCtx,
  raiseDispute,
} from "../../src/server/lib/settlement/index.js";
import { createCommerceRoutes } from "../../src/server/routes/commerce/index";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { createHash, randomUUID } from "node:crypto";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_A_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const PROVIDER_B_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture
const PROVIDER_C_KEY = "0x4bbbf85ce3377467afe5d46f30f0edc6d98e0fb9d4d14cb8aefc2ff952c5f24f"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const providerA = privateKeyToAccount(PROVIDER_A_KEY);
const providerB = privateKeyToAccount(PROVIDER_B_KEY);
const providerC = privateKeyToAccount(PROVIDER_C_KEY);

type Account = ReturnType<typeof privateKeyToAccount>;

let db: Database;

function makeApp() {
  db = createDatabase({ enabled: false });
  const service = createCommerceService(db.commerce, {
    settlement: createCommerceSettlementBridge(() => db),
  });
  const app = new Hono();
  app.route("/", createCommerceRoutes(service));
  return app;
}

beforeEach(() => {
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
    ...(idemKey ? { idempotency_key: idemKey } : {}),
  };
}

async function req(
  app: Hono,
  method: string,
  path: string,
  opts: { account?: Account; body?: unknown; idemKey?: string } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers = opts.account
    ? await sigHeaders(opts.account, method, path, rawBody, opts.idemKey)
    : { "content-type": "application/json" };
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: rawBody || undefined,
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function mkTask(app: Hono, body: Record<string, unknown>) {
  const r = await req(app, "POST", "/api/commerce/tasks", {
    account: buyer,
    body,
  });
  expect(r.status).toBe(201);
  return r.body.task as { id: string; status: string };
}

async function mkOffer(app: Hono, taskId: string, provider: Account, price = "10.00") {
  const r = await req(app, "POST", `/api/commerce/tasks/${taskId}/offers`, {
    account: provider,
    body: { price, currency: "USD", proposal: "I can do it" },
  });
  expect(r.status).toBe(201);
  return r.body.offer as { id: string; status: string };
}

async function accept(app: Hono, offerId: string) {
  return req(app, "POST", `/api/commerce/offers/${offerId}/accept`, {
    account: buyer,
  });
}

describe("commerce → settlement wiring (SLICE-227-5)", () => {
  it("accept → plan auto-created; submit(milestoneRef) → READY; review ACCEPTED → APPROVED + intent", async () => {
    const app = makeApp();
    const task = await mkTask(app, { title: "t", description: "d" });
    const offer = await mkOffer(app, task.id, providerA, "7.50");
    const acc = await accept(app, offer.id);
    expect(acc.status).toBe(200);
    const agreement = acc.body.agreement;
    expect(agreement.status).toBe("ACTIVE");

    // Plan auto-created: agreementRef = agreement.id, milestone "full" = 7.5
    const plan = await db.settlement.plans.getByAgreement(agreement.id);
    expect(plan).not.toBeNull();
    expect(plan!.buyerWallet).toBe(buyer.address.toLowerCase());
    expect(plan!.providerWallet).toBe(providerA.address.toLowerCase());
    const milestones = await db.settlement.milestones.listByPlan(plan!.id);
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.milestoneId).toBe("full");
    expect(milestones[0]!.amountUsd).toBe("7.5");
    expect(milestones[0]!.status).toBe("PENDING");

    // Provider submits work bound to the milestone → milestone READY
    const sub = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agreement.id}/submissions`,
      {
        account: providerA,
        body: { summary: "done", milestoneRef: "full" },
      },
    );
    expect(sub.status).toBe(201);
    expect(sub.body.submission.milestoneRef).toBe("full");
    const mAfter = await db.settlement.milestones.getById(milestones[0]!.id);
    expect(mAfter?.status).toBe("READY");
    expect(mAfter?.submissionRef).toBe(sub.body.submission.id);

    // Buyer accepts → milestone APPROVED + PayoutIntent OPEN + provider leg
    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${sub.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(200);
    expect(rev.body.task.status).toBe("COMPLETED");
    expect(rev.body.agreement.status).toBe("COMPLETED");

    const mFinal = await db.settlement.milestones.getById(milestones[0]!.id);
    expect(mFinal?.status).toBe("APPROVED");
    const intent = await db.settlement.payoutIntents.getByMilestone(
      milestones[0]!.id,
    );
    expect(intent).not.toBeNull();
    expect(intent!.status).toBe("OPEN");
    const legs = await db.settlement.payoutLegs.listByIntent(intent!.id);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.role).toBe("PROVIDER");
    expect(legs[0]!.payee).toBe(providerA.address.toLowerCase());
    expect(legs[0]!.amountUsdc).toBe("7.5");
  });

  it("task detail returns agreements[] with settlementRef", async () => {
    const app = makeApp();
    const task = await mkTask(app, { title: "t", description: "d" });
    const offer = await mkOffer(app, task.id, providerA);
    await accept(app, offer.id);
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: buyer,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.agreement.settlementRef).toBe(detail.body.agreement.id);
    expect(detail.body.agreements).toHaveLength(1);
    expect(detail.body.agreements[0].settlementRef).toBe(
      detail.body.agreements[0].id,
    );
  });

  it("maxProviders=2: two accepts OK, quota fill auto-rejects leftovers", async () => {
    const app = makeApp();
    const task = await mkTask(app, {
      title: "multi",
      description: "d",
      maxProviders: 2,
    });
    const o1 = await mkOffer(app, task.id, providerA);
    const o2 = await mkOffer(app, task.id, providerB);
    const o3 = await mkOffer(app, task.id, providerC);

    const a1 = await accept(app, o1.id);
    expect(a1.status).toBe(200);
    // sibling offers NOT auto-rejected while quota remains
    const mid = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: buyer,
    });
    expect(mid.body.task.status).toBe("IN_PROGRESS");
    const pending = (mid.body.offers as { status: string }[]).filter(
      (o) => o.status === "PENDING",
    );
    expect(pending).toHaveLength(2);

    const a2 = await accept(app, o2.id);
    expect(a2.status).toBe(200);
    // quota filled → o3 auto-rejected; further accept → 409
    const a3 = await accept(app, o3.id);
    expect(a3.status).toBe(409);
    // both agreements got settlement plans
    for (const ag of [a1.body.agreement, a2.body.agreement]) {
      expect(
        await db.settlement.plans.getByAgreement(ag.id),
      ).not.toBeNull();
    }
    const detail = await req(app, "GET", `/api/commerce/tasks/${task.id}`, {
      account: buyer,
    });
    expect(detail.body.agreements).toHaveLength(2);
  });

  it("task COMPLETED only when ALL agreements complete", async () => {
    const app = makeApp();
    const task = await mkTask(app, {
      title: "multi",
      description: "d",
      maxProviders: 2,
    });
    const o1 = await mkOffer(app, task.id, providerA, "5.00");
    const o2 = await mkOffer(app, task.id, providerB, "6.00");
    const a1 = await accept(app, o1.id);
    const a2 = await accept(app, o2.id);
    const agA = a1.body.agreement.id;
    const agB = a2.body.agreement.id;

    // Provider A finishes → agreement COMPLETED, task still IN_PROGRESS
    const s1 = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agA}/submissions`,
      { account: providerA, body: { summary: "done A", milestoneRef: "full" } },
    );
    expect(s1.status).toBe(201);
    const r1 = await req(
      app,
      "POST",
      `/api/commerce/submissions/${s1.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(r1.status).toBe(200);
    expect(r1.body.agreement.status).toBe("COMPLETED");
    expect(r1.body.task.status).toBe("IN_PROGRESS");

    // Provider B finishes → task COMPLETED
    const s2 = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agB}/submissions`,
      { account: providerB, body: { summary: "done B", milestoneRef: "full" } },
    );
    expect(s2.status).toBe(201);
    const r2 = await req(
      app,
      "POST",
      `/api/commerce/submissions/${s2.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(r2.body.task.status).toBe("COMPLETED");
    // both plans have OPEN payout intents
    for (const ag of [agA, agB]) {
      const plan = await db.settlement.plans.getByAgreement(ag);
      const ms = await db.settlement.milestones.listByPlan(plan!.id);
      const intent = await db.settlement.payoutIntents.getByMilestone(
        ms[0]!.id,
      );
      expect(intent?.status).toBe("OPEN");
    }
  });

  it("milestoneRef guards: foreign plan ref → 400; missing bridge-wiring N/A; bad ref → 400", async () => {
    const app = makeApp();
    const task = await mkTask(app, { title: "t", description: "d" });
    const offer = await mkOffer(app, task.id, providerA);
    const acc = await accept(app, offer.id);
    const agId = acc.body.agreement.id;
    const r = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      {
        account: providerA,
        body: { summary: "x", milestoneRef: "no-such-ms" },
      },
    );
    expect(r.status).toBe(400);
  });

  // R2-H4: manual payouts lag acceptance by design — an APPROVED
  // milestone still awaiting its payout must NOT block agreement/task
  // completion (previously counted as "pending" → permanent ACTIVE).
  it("agreement completes on last accepted milestone while an earlier one awaits payout", async () => {
    const app = makeApp();
    const task = await mkTask(app, { title: "t", description: "d" });
    const offer = await req(
      app,
      "POST",
      `/api/commerce/tasks/${task.id}/offers`,
      {
        account: providerA,
        body: {
          price: "10.00",
          currency: "USD",
          proposal: "two phases",
          payload: {
            milestones: [
              { milestoneId: "p1", title: "phase 1", amountUsd: "7.50" },
              { milestoneId: "p2", title: "phase 2", amountUsd: "2.50" },
            ],
          },
        },
      },
    );
    expect(offer.status).toBe(201);
    const acc = await accept(app, offer.body.offer.id);
    expect(acc.status).toBe(200);
    const agId = acc.body.agreement.id;
    const plan = await db.settlement.plans.getByAgreement(agId);
    const milestones = await db.settlement.milestones.listByPlan(plan!.id);
    expect(milestones).toHaveLength(2);

    // Phase 1 accepted → APPROVED + OPEN intent, unpaid by design.
    const s1 = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      { account: providerA, body: { summary: "p1", milestoneRef: "p1" } },
    );
    const r1 = await req(
      app,
      "POST",
      `/api/commerce/submissions/${s1.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(r1.status).toBe(200);
    expect(r1.body.agreement.status).toBe("ACTIVE"); // p2 still pending

    // Phase 2 accepted → agreement COMPLETED even though p1's payout
    // intent is still OPEN/unpaid (ops pays it asynchronously).
    const s2 = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      { account: providerA, body: { summary: "p2", milestoneRef: "p2" } },
    );
    const r2 = await req(
      app,
      "POST",
      `/api/commerce/submissions/${s2.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(r2.status).toBe(200);
    expect(r2.body.agreement.status).toBe("COMPLETED");
    expect(r2.body.task.status).toBe("COMPLETED");
  });

  // R2-H5: accepting work whose milestone is not READY (here: frozen by
  // a dispute raised between submit and review) must fail the review —
  // the old code swallowed it and completed the agreement unpaid.
  it("review ACCEPTED → 409 when the bound milestone left READY", async () => {
    const app = makeApp();
    const task = await mkTask(app, { title: "t", description: "d" });
    const offer = await mkOffer(app, task.id, providerA);
    const acc = await accept(app, offer.id);
    const agId = acc.body.agreement.id;
    const sub = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      { account: providerA, body: { summary: "done", milestoneRef: "full" } },
    );
    expect(sub.status).toBe(201);

    // A dispute lands between submit and review — milestone frozen.
    const plan = await db.settlement.plans.getByAgreement(agId);
    const ms = await db.settlement.milestones.listByPlan(plan!.id);
    const sctx = createSettlementCtx(db);
    const d = await raiseDispute(sctx, {
      subjectType: "MILESTONE",
      subjectRef: ms[0]!.id,
      raisedBy: buyer.address.toLowerCase(),
      reason: "quality concern",
    });
    expect(d.ok).toBe(true);

    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${sub.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(409);
    // The submission stays reviewable — nothing terminal was committed.
    const stored = await db.commerce.submissions.getById(
      sub.body.submission.id,
    );
    expect(stored?.status).toBe("SUBMITTED");
    const ag = await db.commerce.agreements.getById(agId);
    expect(ag?.status).toBe("ACTIVE");
  });
});
