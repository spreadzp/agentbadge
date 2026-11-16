/**
 * SLICE-234-16 (bug): lazy actor upsert on signed writes (D-225-3).
 * Before the fix, `resolveOrCreate` was only reachable via the
 * /enrich endpoint — a full commerce flow left no Actor row
 * (found by cloud Devin prod e2e, 2026-11-16).
 *
 * Contract: a successful signed write touches the Actor row via
 * the injected `setSignedWriteHook`; hook failure never fails
 * the write itself (best-effort, warn-logged).
 */

import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import {
  createInMemoryCommerceStores,
  createInMemoryIdentityStores,
} from "@agentbadge/database";
import { createCommerceService } from "../src/server/lib/commerce";
import { createCommerceRoutes } from "../src/server/routes/commerce/index";
import {
  buildCommerceChallenge,
  setSignedWriteHook,
} from "../src/server/routes/commerce/shared";
import { createIdentityService } from "../src/server/lib/identity/index.js";
import { createHash, randomUUID } from "node:crypto";

const BUYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // secret-scan:allow: anvil test fixture
const buyer = privateKeyToAccount(BUYER_KEY);

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

async function createTask(app: Hono) {
  const body = JSON.stringify({
    title: "actor touch task",
    description: "lazy upsert check",
  });
  const res = await app.request("/api/commerce/tasks", {
    method: "POST",
    headers: await sigHeaders(buyer, "POST", "/api/commerce/tasks", body),
    body,
  });
  return res;
}

describe("SLICE-234-16: lazy actor upsert on signed writes", () => {
  afterEach(() => setSignedWriteHook(null));

  it("signed commerce write creates the Actor row", async () => {
    const identity = createInMemoryIdentityStores();
    const svc = createIdentityService({ identity });
    setSignedWriteHook((w) => svc.ensureActor(w));

    const app = makeApp();
    const res = await createTask(app);
    expect(res.status).toBe(201);

    const actor = await svc.actors.get(buyer.address.toLowerCase());
    expect(actor).not.toBeNull();
    expect(actor!.wallet).toBe(buyer.address.toLowerCase());
  });

  it("hook failure does not fail the write (best-effort)", async () => {
    setSignedWriteHook(async () => {
      throw new Error("identity store down");
    });

    const app = makeApp();
    const res = await createTask(app);
    expect(res.status).toBe(201);
  });

  it("existing actor row is left untouched (ensure, not re-create)", async () => {
    const identity = createInMemoryIdentityStores();
    const svc = createIdentityService({ identity });
    const before = await svc.actors.resolveOrCreate(
      buyer.address.toLowerCase(),
    );
    setSignedWriteHook((w) => svc.ensureActor(w));

    const app = makeApp();
    const res = await createTask(app);
    expect(res.status).toBe(201);

    const after = await svc.actors.get(buyer.address.toLowerCase());
    expect(after!.wallet).toBe(before.wallet);
    expect(after!.type).toBe(before.type);
    expect(after!.createdAt).toBe(before.createdAt);
  });
});

// ─── SLICE-234-23: requirements scalar → 400, not 500 ─────────────

describe("SLICE-234-23: task requirements scalar rejection", () => {
  afterEach(() => setSignedWriteHook(null));

  it.each([
    ["string", "DEVIN-TEST string"],
    ["number", 42],
    ["boolean", true],
  ])("requirements %s → 400 INVALID_INPUT", async (_label, value) => {
    const app = makeApp();
    const r = await signedPost(app, buyer, "/api/commerce/tasks", {
      title: "scalar req",
      description: "rejected",
      requirements: value,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_INPUT");
  });

  it.each([
    ["object", { a: 1 }],
    ["array", ["x"]],
    ["null", null],
  ])("requirements %s → 201", async (_label, value) => {
    const app = makeApp();
    const r = await signedPost(app, buyer, "/api/commerce/tasks", {
      title: "ok req",
      description: "accepted",
      requirements: value,
    });
    expect(r.status).toBe(201);
  });
});

// ─── SLICE-234-17: commerce completion → ReputationFacts ───────────

const PROVIDER_KEY =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const provider = privateKeyToAccount(PROVIDER_KEY);

async function signedPost(
  app: Hono,
  account: ReturnType<typeof privateKeyToAccount>,
  path: string,
  body?: unknown,
) {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const res = await app.request(path, {
    method: "POST",
    headers: await sigHeaders(account, "POST", path, rawBody),
    body: rawBody || undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe("SLICE-234-17: facts emit on submission ACCEPTED-complete", () => {
  afterEach(() => setSignedWriteHook(null));

  it("happy path → provider gets SUBMISSION_ACCEPTED + TASK_COMPLETED facts", async () => {
    const identity = createInMemoryIdentityStores();
    const svc = createIdentityService({
      identity,
      verifySource: async () => true,
    });
    const commerce = createCommerceService(
      createInMemoryCommerceStores(),
      {
        onSubmissionAccepted: async ({
          submissionId,
          agreementId,
          providerWallet,
        }) => {
          await svc.facts.submissionAccepted(providerWallet, submissionId);
          await svc.facts.taskCompleted(providerWallet, agreementId);
        },
      },
    );
    const app = new Hono();
    app.route("/", createCommerceRoutes(commerce));

    const taskRes = await signedPost(app, buyer, "/api/commerce/tasks", {
      title: "facts emit task",
      description: "happy path",
    });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.task.id as string;

    const offerRes = await signedPost(
      app,
      provider,
      `/api/commerce/tasks/${taskId}/offers`,
      { price: "10.00", proposal: "will do" },
    );
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body.offer.id as string;

    const acceptRes = await signedPost(
      app,
      buyer,
      `/api/commerce/offers/${offerId}/accept`,
    );
    expect(acceptRes.status).toBe(200);
    const agreementId = acceptRes.body.agreement.id as string;

    const subRes = await signedPost(
      app,
      provider,
      `/api/commerce/agreements/${agreementId}/submissions`,
      { summary: "done", evidenceRefs: ["https://x"] },
    );
    expect(subRes.status).toBe(201);
    const submissionId = subRes.body.submission.id as string;

    const reviewRes = await signedPost(
      app,
      buyer,
      `/api/commerce/submissions/${submissionId}/review`,
      { verdict: "ACCEPTED" },
    );
    expect(reviewRes.status).toBe(200);

    const wallet = provider.address.toLowerCase();
    const facts = await svc.facts.listByActor(wallet);
    const types = facts.map((f) => f.factType).sort();
    expect(types).toEqual(["SUBMISSION_ACCEPTED", "TASK_COMPLETED"]);
    const refs = facts.map((f) => f.sourceRef).sort();
    expect(refs).toEqual(
      [`agreement:${agreementId}`, `submission:${submissionId}`].sort(),
    );

    // dedupe: second emit of the same refs collapses to no-op rows
    expect(await svc.facts.taskCompleted(wallet, agreementId)).toBeNull();
  });

  it("hook failure does not fail the ACCEPTED transition", async () => {
    const commerce = createCommerceService(
      createInMemoryCommerceStores(),
      {
        onSubmissionAccepted: async () => {
          throw new Error("facts store down");
        },
      },
    );
    const app = new Hono();
    app.route("/", createCommerceRoutes(commerce));

    const taskRes = await signedPost(app, buyer, "/api/commerce/tasks", {
      title: "hook-fail task",
      description: "transition survives",
    });
    const taskId = taskRes.body.task.id as string;
    const offerRes = await signedPost(
      app,
      provider,
      `/api/commerce/tasks/${taskId}/offers`,
      { price: "5.00", proposal: "ok" },
    );
    const acceptRes = await signedPost(
      app,
      buyer,
      `/api/commerce/offers/${offerRes.body.offer.id}/accept`,
    );
    const subRes = await signedPost(
      app,
      provider,
      `/api/commerce/agreements/${acceptRes.body.agreement.id}/submissions`,
      { summary: "done", evidenceRefs: [] },
    );
    const reviewRes = await signedPost(
      app,
      buyer,
      `/api/commerce/submissions/${subRes.body.submission.id}/review`,
      { verdict: "ACCEPTED" },
    );
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.agreement.status).toBe("COMPLETED");
  });
});
