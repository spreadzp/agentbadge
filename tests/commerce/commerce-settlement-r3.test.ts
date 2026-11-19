/**
 * SLICE-227-8 (EPIC-227 / R3): unbound submissions, pre-commit
 * approve failure, offer milestone-term validation.
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
import { createCommerceRoutes } from "../../src/server/routes/commerce/index";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { createHash, randomUUID } from "node:crypto";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_A_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const providerA = privateKeyToAccount(PROVIDER_A_KEY);

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

describe("R3: unbound submissions + pre-commit approve + offer terms", () => {
  // R3-H2: a plan-having agreement must never complete unpaid — an
  // unbound submission auto-binds when the plan has exactly one
  // pending milestone.
  it("auto-binds a missing milestoneRef to the sole pending milestone", async () => {
    const app = makeApp();
    const task = await mkTask(app, { title: "t", description: "d" });
    const offer = await mkOffer(app, task.id, providerA);
    const acc = await accept(app, offer.id);
    const agId = acc.body.agreement.id;

    const sub = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      { account: providerA, body: { summary: "done" } },
    );
    expect(sub.status).toBe(201);
    expect(sub.body.submission.milestoneRef).toBe("full");
    const plan = await db.settlement.plans.getByAgreement(agId);
    const ms = await db.settlement.milestones.listByPlan(plan!.id);
    expect((await db.settlement.milestones.getById(ms[0]!.id))?.status)
      .toBe("READY");

    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${sub.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(200);
    expect(rev.body.agreement.status).toBe("COMPLETED");
    expect((await db.settlement.milestones.getById(ms[0]!.id))?.status)
      .toBe("APPROVED");
  });

  it("rejects a missing milestoneRef when several milestones are pending", async () => {
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
          proposal: "p",
          payload: {
            milestones: [
              { milestoneId: "m1", title: "one", amountUsd: "6.00" },
              { milestoneId: "m2", title: "two", amountUsd: "4.00" },
            ],
          },
        },
      },
    );
    expect(offer.status).toBe(201);
    const acc = await accept(app, offer.body.offer.id);
    expect(acc.status).toBe(200);
    const plan = await db.settlement.plans.getByAgreement(
      acc.body.agreement.id,
    );
    expect(
      (await db.settlement.milestones.listByPlan(plan!.id)).length,
    ).toBe(2);

    const sub = await req(
      app,
      "POST",
      `/api/commerce/agreements/${acc.body.agreement.id}/submissions`,
      { account: providerA, body: { summary: "done" } },
    );
    expect(sub.status).toBe(400);
    const stored = await db.commerce.submissions.listByAgreement(
      acc.body.agreement.id,
    );
    expect(stored).toHaveLength(0);
  });

  // R3-H3: the approve runs BEFORE the commerce verdict commits — a
  // settlement failure must leave the submission SUBMITTED, never a
  // committed ACCEPTED with unpaid work.
  it("review ACCEPTED → 409 + SUBMITTED preserved when approve fails", async () => {
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

    // Poison the approve path: an intent already bound to the
    // milestone makes doApprove CONFLICT — deterministic without
    // stubbing the bridge.
    const plan = await db.settlement.plans.getByAgreement(agId);
    const ms = await db.settlement.milestones.listByPlan(plan!.id);
    await db.settlement.payoutIntents.create({
      id: `pi_${crypto.randomUUID()}`,
      milestoneRef: ms[0]!.id,
      executor: "MANUAL",
      status: "OPEN",
      createdAtMs: Date.now(),
      payload: {},
    });

    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${sub.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(409);
    const stored = await db.commerce.submissions.getById(
      sub.body.submission.id,
    );
    expect(stored?.status).toBe("SUBMITTED");
    const ag = await db.commerce.agreements.getById(agId);
    expect(ag?.status).toBe("ACTIVE");
    // Milestone untouched — still READY for the recovery path.
    expect((await db.settlement.milestones.getById(ms[0]!.id))?.status)
      .toBe("READY");
  });

  // M-5: malformed provider-authored milestone terms must be rejected
  // at offer intake — not discovered at accept or plan-create.
  it("offer create rejects a milestone vector that doesn't sum to price", async () => {
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
          proposal: "p",
          payload: {
            milestones: [
              { milestoneId: "m1", title: "one", amountUsd: "6.00" },
              { milestoneId: "m2", title: "two", amountUsd: "9.00" },
            ],
          },
        },
      },
    );
    expect(offer.status).toBe(400);
  });
});
