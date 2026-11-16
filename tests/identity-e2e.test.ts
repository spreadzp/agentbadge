/**
 * SLICE-225-4 (EPIC-225): E2E — purchase → entitlement → gated
 * access + reputation facts, exercised through the real route
 * surface (createIdentityRoutes) on the in-memory backend.
 *
 *   payment CONFIRMED ──sweep──▶ entitlement ACTIVE ──check()──▶ gate allows
 *   facts emitted ──▶ GET /api/v1/reputation/:wallet shows sourceRefs
 *   actor lazy-created → enrich (EIP-191) → GET /api/v1/actors/:wallet
 *
 * Negative paths: no payment, revoked, expired validUntil, duplicate
 * activation, non-catalog product, non-wallet customerId.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { randomUUID, createHash } from "node:crypto";
import {
  createInMemoryIdentityStores,
  createInMemoryPaymentStores,
  type IdentityStores,
  type PaymentInsert,
  type PaymentStores,
} from "@agentbadge/database";

import { createIdentityService } from "../src/server/lib/identity/index.js";
import { createIdentityRoutes } from "../src/server/routes/identity-api.js";
import { buildCommerceChallenge } from "../src/server/routes/commerce/shared";
import { createMemoryAgentRegistrationStore } from "../src/server/lib/agent-registration/store.js";

const OWNER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // secret-scan:allow: anvil test fixture
const owner = privateKeyToAccount(OWNER_KEY);
const W_OWNER = owner.address.toLowerCase();
const W_OTHER = "0x2222222222222222222222222222222222222222";

let identity: IdentityStores;
let payments: PaymentStores;
let svc: ReturnType<typeof createIdentityService>;
let app: Hono;
let clock = 1_700_000_000_000;

beforeEach(() => {
  identity = createInMemoryIdentityStores();
  payments = createInMemoryPaymentStores();
  clock = 1_700_000_000_000;
  svc = createIdentityService({
    identity,
    payments,
    registrations: createMemoryAgentRegistrationStore(),
    passports: {
      // Fake onchain ownerOf — token 77 belongs to the test owner.
      async ownerOf(tokenId: string) {
        return tokenId === "77" ? W_OWNER : null;
      },
    },
    // v2 N-3: non-payment fact emits deny-by-default without a
    // source verifier — tests stub it.
    verifySource: async () => true,
    nowMs: () => clock,
  });
  app = new Hono();
  app.route("/", createIdentityRoutes(svc));
});

/** Simulated enforcement seam — the middleware contract (D-225-6):
 *  check() returns the entitlement row or null; access iff row. */
async function gatedAccess(wallet: string, productCode: string) {
  const ent = await svc.entitlements.check(wallet, productCode);
  return ent === null
    ? { allowed: false as const }
    : { allowed: true as const, validUntilMs: ent.validUntilMs };
}

async function confirmedPayment(over: Partial<PaymentInsert> = {}) {
  const p = await payments.payments.create({
    id: `pay_${Math.random().toString(16).slice(2, 10)}`,
    reference: `ref_${Math.random().toString(16).slice(2, 10)}`,
    customerId: W_OWNER,
    productId: "PASSPORT_BRONZE",
    amount: "9.99",
    currency: "USD",
    status: "CONFIRMED",
    purpose: "product purchase",
    createdAtMs: clock - 1000,
    updatedAtMs: clock - 500,
    payload: {},
    ...over,
  });
  if (!p) throw new Error("payment create returned null");
  const a = await payments.attempts.create({
    id: `att_${Math.random().toString(16).slice(2, 10)}`,
    paymentId: p.id,
    provider: "DIRECT_USDC",
    network: "eip155:5042002",
    amount: "9.99",
    currency: "USD",
    status: "CONFIRMED",
    transactionHash: `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}`.slice(0, 66),
    confirmedAtMs: clock - 400,
    payload: {},
  });
  if (!a) throw new Error("attempt create returned null");
  return p;
}

async function sigHeaders(
  account: ReturnType<typeof privateKeyToAccount>,
  method: string,
  path: string,
  rawBody: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = buildCommerceChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: rawBody
      ? createHash("sha256").update(rawBody).digest("hex")
      : "-",
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

// ---------- happy path: purchase → entitlement → access ----------

describe("e2e: purchase → entitlement → gated access", () => {
  it("CONFIRMED payment sweeps into an ACTIVE entitlement; check() opens the gate; REST shows the row", async () => {
    const payment = await confirmedPayment();

    // Before sweep: no entitlement, gate closed.
    expect(await svc.entitlements.check(W_OWNER, "PASSPORT_BRONZE")).toBeNull();
    expect((await gatedAccess(W_OWNER, "PASSPORT_BRONZE")).allowed).toBe(false);

    const result = await svc.sweep();
    expect(result.granted).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Gate opens — row proves provenance.
    const gate = await gatedAccess(W_OWNER, "PASSPORT_BRONZE");
    expect(gate.allowed).toBe(true);

    // Provenance is bound at the service layer…
    const stored = await svc.entitlements.check(W_OWNER, "PASSPORT_BRONZE");
    expect(stored?.sourcePaymentId).toBe(payment.id);

    // …but H-6 redacts it (and other internal fields) from the
    // public REST row.
    const res = await app.request(
      `/api/v1/entitlements/${W_OWNER}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitlements).toHaveLength(1);
    const row = body.entitlements[0];
    expect(row.status).toBe("ACTIVE");
    expect(row.productCode).toBe("PASSPORT_BRONZE");
    expect(row.sourcePaymentId).toBeUndefined();
    expect(row.idempotencyKey).toBeUndefined();
    expect(row.payload).toBeUndefined();
    expect(row.validFromMs).toBeGreaterThan(0);
  });

  it("a second sweep dedupes — entitlement stays single + ACTIVE", async () => {
    await confirmedPayment();
    const first = await svc.sweep();
    const second = await svc.sweep();
    expect(first.granted).toBe(1);
    expect(second.granted).toBe(0);
    expect(second.deduped).toBe(1);
    const rows = await svc.entitlements.listByOwner(W_OWNER);
    expect(rows).toHaveLength(1);
  });
});

// ---------- negative paths ----------

describe("e2e: negative paths", () => {
  it("no payment → sweep grants nothing → gate stays closed", async () => {
    const result = await svc.sweep();
    expect(result.granted).toBe(0);
    expect((await gatedAccess(W_OWNER, "PASSPORT_BRONZE")).allowed).toBe(false);
  });

  it("revoked entitlement closes the gate", async () => {
    await confirmedPayment();
    await svc.sweep();
    const [row] = await svc.entitlements.listByOwner(W_OWNER);
    await svc.entitlements.revoke(row.id);
    expect((await gatedAccess(W_OWNER, "PASSPORT_BRONZE")).allowed).toBe(false);
  });

  it("expired validUntil closes the gate lazily", async () => {
    const { grant } = svc.entitlements;
    await grant({
      ownerId: W_OWNER,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_direct",
      validFromMs: clock - 10_000,
      validUntilMs: clock - 1000, // already past
    });
    // check() lazily flips ACTIVE→EXPIRED and denies.
    expect(await svc.entitlements.check(W_OWNER, "PASSPORT_BRONZE")).toBeNull();
    const [row] = await svc.entitlements.listByOwner(W_OWNER);
    expect(row.status).toBe("EXPIRED");
  });

  it("non-catalog product + non-wallet customerId are skipped, not granted", async () => {
    await confirmedPayment({ productId: "DIRECTORY_LISTING" });
    await confirmedPayment({ customerId: "email@example.com" });
    const result = await svc.sweep();
    expect(result.granted).toBe(0);
    expect(result.skipped.length).toBeGreaterThanOrEqual(2);
    expect(await svc.entitlements.listByOwner(W_OWNER)).toHaveLength(0);
  });

  it("PENDING payment is skipped even with a CONFIRMED attempt", async () => {
    await confirmedPayment({ status: "PENDING" });
    const result = await svc.sweep();
    expect(result.granted).toBe(0);
    expect((await gatedAccess(W_OWNER, "PASSPORT_BRONZE")).allowed).toBe(false);
  });
});

// ---------- facts e2e ----------

describe("e2e: reputation facts", () => {
  it("task completed + payment verified facts carry resolvable sourceRefs and are queryable via REST", async () => {
    const payment = await confirmedPayment();
    await svc.sweep();

    // Emit the facts a real flow would produce.
    await svc.facts.paymentVerified(W_OWNER, payment.id);
    await svc.facts.taskCompleted(W_OWNER, "agr_42");
    await svc.facts.submissionAccepted(W_OWNER, "sub_9");

    const res = await app.request(`/api/v1/reputation/${W_OWNER}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.PAYMENT_VERIFIED).toBe(1);
    expect(body.counts.TASK_COMPLETED).toBe(1);
    expect(body.counts.SUBMISSION_ACCEPTED).toBe(1);

    // sourceRefs resolve to the auditable records they describe.
    const byType = Object.fromEntries(
      body.facts.map((f: { factType: string; sourceRef: string }) => [
        f.factType,
        f.sourceRef,
      ]),
    );
    expect(byType.PAYMENT_VERIFIED).toBe(`payment:${payment.id}`);
    expect(byType.TASK_COMPLETED).toBe("agreement:agr_42");
    expect(byType.SUBMISSION_ACCEPTED).toBe("submission:sub_9");

    // The payment fact's sourceRef resolves to a real payment row.
    const provenance = await payments.payments.getById(payment.id);
    expect(provenance?.status).toBe("CONFIRMED");

    // factType filter narrows the REST read.
    const filtered = await app.request(
      `/api/v1/reputation/${W_OWNER}?factType=PAYMENT_VERIFIED`,
    );
    const fBody = await filtered.json();
    expect(fBody.facts).toHaveLength(1);
    expect(fBody.facts[0].factType).toBe("PAYMENT_VERIFIED");
  });

  it("duplicate emission is a no-op (append-only dedupe)", async () => {
    await svc.facts.taskCompleted(W_OWNER, "agr_1");
    await svc.facts.taskCompleted(W_OWNER, "agr_1");
    const res = await app.request(
      `/api/v1/reputation/${W_OWNER}?factType=TASK_COMPLETED`,
    );
    const body = await res.json();
    expect(body.facts).toHaveLength(1);
  });
});

// ---------- actor e2e ----------

describe("e2e: actor lifecycle via REST", () => {
  it("lazy create → signed enrich → GET shows links; other wallet stays isolated", async () => {
    // First action creates the lazy record.
    await svc.actors.resolveOrCreate(W_OWNER, { did: "did:web:first" });
    const get0 = await app.request(`/api/v1/actors/${W_OWNER}`);
    expect((await get0.json()).actor.type).toBe("EXTERNAL_AGENT");

    // Owner enriches via the signed write.
    const path = `/api/v1/actors/${W_OWNER}/enrich`;
    const rawBody = JSON.stringify({
      passportTokenId: "77",
      did: "did:web:enriched",
    });
    const res = await app.request(path, {
      method: "POST",
      body: rawBody,
      headers: await sigHeaders(owner, "POST", path, rawBody),
    });
    expect(res.status).toBe(200);

    // GET reflects the enrichment — passport flips type.
    const get1 = await app.request(`/api/v1/actors/${W_OWNER}`);
    const actor = (await get1.json()).actor;
    expect(actor.passportTokenId).toBe("77");
    expect(actor.did).toBe("did:web:enriched");
    expect(actor.type).toBe("REGISTERED_USER");

    // Isolation: a different wallet has no actor row.
    const other = await app.request(`/api/v1/actors/${W_OTHER}`);
    expect(other.status).toBe(404);
  });
});
