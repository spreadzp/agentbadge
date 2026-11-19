/**
 * SLICE-227-8 (EPIC-227 / R4): review-gate preconditions, approval
 * revert, milestone release on reject, no-plan fail-closed.
 *
 * R4-H1 — the pre-commit approve ran BEFORE any commerce check: a
 * stale ACCEPT on a REJECTED submission minted APPROVED + OPEN intent.
 * Now the gate mirrors the verdict atomic (buyer/SUBMITTED/UNDER_
 * REVIEW/ACTIVE) read-only, and a raced approve reverts.
 * R4-M5 — a rejected bound submission releases its milestone
 * (READY→PENDING) so the resubmission round can rebind.
 * R4-M6 — "no plan" is null, not 0: the review 409s instead of
 * completing the agreement unpaid.
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
import {
  createCommerceSettlementBridge,
  type CommerceSettlementBridge,
} from "../../src/server/lib/commerce/settlement-bridge";
import { createCommerceRoutes } from "../../src/server/routes/commerce/index";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { createHash, randomUUID } from "node:crypto";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_A_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const STRANGER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // secret-scan:allow: anvil test fixture

const buyer = privateKeyToAccount(BUYER_KEY);
const providerA = privateKeyToAccount(PROVIDER_A_KEY);
const stranger = privateKeyToAccount(STRANGER_KEY);

type Account = ReturnType<typeof privateKeyToAccount>;

let db: Database;

function makeApp(bridge?: CommerceSettlementBridge) {
  db = createDatabase({ enabled: false });
  const service = createCommerceService(db.commerce, {
    settlement: bridge ?? createCommerceSettlementBridge(() => db),
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
    idemKey: "-",
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
  opts: { account?: Account; body?: unknown } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers = opts.account
    ? await sigHeaders(opts.account, method, path, rawBody)
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

async function boundSubmission(app: Hono) {
  const task = await req(app, "POST", "/api/commerce/tasks", {
    account: buyer,
    body: { title: "t", description: "d" },
  });
  const offer = await req(
    app,
    "POST",
    `/api/commerce/tasks/${task.body.task.id}/offers`,
    {
      account: providerA,
      body: { price: "10.00", currency: "USD", proposal: "p" },
    },
  );
  const acc = await req(
    app,
    "POST",
    `/api/commerce/offers/${offer.body.offer.id}/accept`,
    { account: buyer },
  );
  const agId = acc.body.agreement.id as string;
  const sub = await req(
    app,
    "POST",
    `/api/commerce/agreements/${agId}/submissions`,
    {
      account: providerA,
      body: { summary: "done", milestoneRef: "full" },
    },
  );
  expect(sub.status).toBe(201);
  const plan = await db.settlement.plans.getByAgreement(agId);
  const ms = await db.settlement.milestones.listByPlan(plan!.id);
  return { agId, subId: sub.body.submission.id as string, milestone: ms[0]! };
}

describe("R4: review gate preconditions + approval revert + milestone release", () => {
  it("R4-H1: ACCEPT on a REJECTED submission 409s and mints no intent", async () => {
    const app = makeApp();
    const { agId, subId, milestone } = await boundSubmission(app);
    expect(milestone.status).toBe("READY");

    const rej = await req(
      app,
      "POST",
      `/api/commerce/submissions/${subId}/review`,
      { account: buyer, body: { verdict: "REJECTED" } },
    );
    expect(rej.status).toBe(200);
    // R4-M5: the milestone released back to PENDING.
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("PENDING");

    // Force it READY again (operator mid-recovery) — the stale ACCEPT
    // must still fail BEFORE any settlement write.
    await db.settlement.milestones.applyStatus(
      milestone.id,
      "PENDING",
      "READY",
    );
    const stale = await req(
      app,
      "POST",
      `/api/commerce/submissions/${subId}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(stale.status).toBe(400); // already-reviewed guard
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("READY");
    expect(
      await db.settlement.payoutIntents.getByMilestone(milestone.id),
    ).toBeNull();
    expect(
      (await db.commerce.agreements.getById(agId))?.status,
    ).toBe("ACTIVE");
  });

  it("R4-H1: a stranger's review 403s without touching settlement", async () => {
    const app = makeApp();
    const { subId, milestone } = await boundSubmission(app);
    const r = await req(
      app,
      "POST",
      `/api/commerce/submissions/${subId}/review`,
      { account: stranger, body: { verdict: "ACCEPTED" } },
    );
    expect(r.status).toBe(403);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("READY");
    expect(
      await db.settlement.payoutIntents.getByMilestone(milestone.id),
    ).toBeNull();
  });

  it("R4-M5: reject releases the milestone; resubmission rebinds + completes", async () => {
    const app = makeApp();
    const { agId, subId, milestone } = await boundSubmission(app);
    await req(app, "POST", `/api/commerce/submissions/${subId}/review`, {
      account: buyer,
      body: { verdict: "REVISION_REQUIRED" },
    });
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("PENDING");

    // The resubmission round rebinds the same milestoneRef.
    const sub2 = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      {
        account: providerA,
        body: { summary: "v2", milestoneRef: "full" },
      },
    );
    expect(sub2.status).toBe(201);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("READY");

    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${sub2.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(200);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("APPROVED");
    expect(
      (await db.settlement.payoutIntents.getByMilestone(milestone.id))
        ?.status,
    ).toBe("OPEN");
    expect(rev.body.agreement.status).toBe("COMPLETED");
  });

  it("R4-M6: unbound submission on a plan-less agreement → review 409s closed", async () => {
    // Wrap the real bridge: no plan can ever be proven → pending is
    // null (not 0) and openMilestones is empty.
    const real = createCommerceSettlementBridge(() => db);
    const bridge: CommerceSettlementBridge = {
      ...real,
      openMilestones: async () => [],
      pendingMilestoneCount: async () => null,
    };
    const app = makeApp(bridge);
    const task = await req(app, "POST", "/api/commerce/tasks", {
      account: buyer,
      body: { title: "t", description: "d" },
    });
    const offer = await req(
      app,
      "POST",
      `/api/commerce/tasks/${task.body.task.id}/offers`,
      {
        account: providerA,
        body: { price: "10.00", currency: "USD", proposal: "p" },
      },
    );
    const acc = await req(
      app,
      "POST",
      `/api/commerce/offers/${offer.body.offer.id}/accept`,
      { account: buyer },
    );
    const agId = acc.body.agreement.id as string;
    const sub = await req(
      app,
      "POST",
      `/api/commerce/agreements/${agId}/submissions`,
      { account: providerA, body: { summary: "done" } },
    );
    expect(sub.status).toBe(201);

    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${sub.body.submission.id}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(409);
    expect(
      (await db.commerce.submissions.getById(sub.body.submission.id))
        ?.status,
    ).toBe("SUBMITTED");
    expect(
      (await db.commerce.agreements.getById(agId))?.status,
    ).toBe("ACTIVE");
  });

  it("R6-M6: a RELEASED milestone lets the verdict commit (no dead-end)", async () => {
    const app = makeApp();
    const { agId, subId, milestone } = await boundSubmission(app);
    expect(milestone.status).toBe("READY");
    // Operator paid the approved intent out-of-band — the milestone
    // rolled up to RELEASED while the submission still waits for its
    // verdict. The gate must treat it as a resume state, not a 409.
    await db.settlement.milestones.applyStatus(
      milestone.id,
      "READY",
      "APPROVED",
    );
    await db.settlement.milestones.applyStatus(
      milestone.id,
      "APPROVED",
      "RELEASED",
    );
    const rev = await req(
      app,
      "POST",
      `/api/commerce/submissions/${subId}/review`,
      { account: buyer, body: { verdict: "ACCEPTED" } },
    );
    expect(rev.status).toBe(200);
    expect(rev.body.submission.status).toBe("ACCEPTED");
    // pendingCount excludes RELEASED → the agreement completes.
    expect(rev.body.agreement.status).toBe("COMPLETED");
    expect(
      (await db.commerce.agreements.getById(agId))?.status,
    ).toBe("COMPLETED");
  });
});
