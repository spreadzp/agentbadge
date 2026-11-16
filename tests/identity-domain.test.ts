/**
 * SLICE-225-2 (EPIC-225): identity domain services — actor
 * resolution/enrichment, entitlement lifecycle + check(), the
 * activation sweeper, reputation fact emitters.
 *
 * Runs against the in-memory IdentityStores backend
 * (DATABASE_ENABLED=off path) — Postgres parity for stores is
 * covered in packages/database/tests/identity.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryIdentityStores,
  createInMemoryPaymentStores,
  type IdentityStores,
  type PaymentInsert,
  type PaymentStores,
} from "@agentbadge/database";

import { createIdentityService } from "../src/server/lib/identity/index.js";
import { IdentityError } from "../src/server/lib/identity/types.js";
import { createMemoryAgentRegistrationStore } from "../src/server/lib/agent-registration/store.js";

const W_A = "0x1111111111111111111111111111111111111111";
const W_B = "0x2222222222222222222222222222222222222222";

let identity: IdentityStores;
let payments: PaymentStores;
let registrations: ReturnType<typeof createMemoryAgentRegistrationStore>;
let svc: ReturnType<typeof createIdentityService>;

/** Fake passport registry — tokenId → owner wallet (audit C-1). */
const passportOwners = new Map<string, string>();
const passports = {
  async ownerOf(tokenId: string): Promise<string | null> {
    return passportOwners.get(tokenId) ?? null;
  },
};

let clock = 1_700_000_000_000;

beforeEach(() => {
  identity = createInMemoryIdentityStores();
  payments = createInMemoryPaymentStores();
  registrations = createMemoryAgentRegistrationStore();
  passportOwners.clear();
  clock = 1_700_000_000_000;
  svc = createIdentityService({
    identity,
    payments,
    registrations,
    passports,
    nowMs: () => clock,
  });
});

/** Active ERC-8004 registration owned by `owner` for `agentId`. */
async function registerAgent(agentId: string, owner: `0x${string}`) {
  await registrations.put({
    agentId,
    registryAddress: "0x00000000000000000000000000000000000000aa",
    registryTx: `0x${"ef".repeat(32)}`,
    name: `agent-${agentId}`,
    keyHash: "k".repeat(64),
    tier: "observer",
    status: "active",
    createdAt: clock,
    owner,
  });
}

const err = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e as IdentityError;
  }
  throw new Error("expected throw");
};

// ---------- payment fixtures ----------

async function confirmedPayment(over: Partial<PaymentInsert> = {}) {
  const p = await payments.payments.create({
    id: `pay_${Math.random().toString(16).slice(2, 10)}`,
    reference: `ref_${Math.random().toString(16).slice(2, 10)}`,
    customerId: W_A,
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

// ---------- actor service ----------

describe("actor service", () => {
  it("lazy upsert creates EXTERNAL_AGENT by default", async () => {
    const a = await svc.actors.resolveOrCreate(W_A);
    expect(a.wallet).toBe(W_A);
    expect(a.type).toBe("EXTERNAL_AGENT");
    expect(a.agentId).toBeNull();
  });

  it("REGISTERED_* type hints are rejected", async () => {
    const e = await err(() =>
      svc.actors.resolveOrCreate(W_A, { type: "REGISTERED_USER" }),
    );
    expect(e.code).toBe("INVALID");
  });

  it("hint.type EXTERNAL_HUMAN wins over default", async () => {
    const a = await svc.actors.resolveOrCreate(W_A, {
      type: "EXTERNAL_HUMAN",
    });
    expect(a.type).toBe("EXTERNAL_HUMAN");
  });

  it("verified passport link resolves REGISTERED_USER", async () => {
    passportOwners.set("pass_123", W_A);
    const a = await svc.actors.resolveOrCreate(W_A, {
      passportTokenId: "pass_123",
    });
    expect(a.type).toBe("REGISTERED_USER");
    expect(a.passportTokenId).toBe("pass_123");
  });

  it("C-1: unowned passportTokenId is rejected — no self-mint", async () => {
    passportOwners.set("pass_123", W_B); // someone else's passport
    const e = await err(() =>
      svc.actors.resolveOrCreate(W_A, { passportTokenId: "pass_123" }),
    );
    expect(e.code).toBe("INVALID");
    const unknown = await err(() =>
      svc.actors.resolveOrCreate(W_A, { passportTokenId: "pass_404" }),
    );
    expect(unknown.code).toBe("INVALID");
  });

  it("C-1: passportTokenId write fails closed without a passports port", async () => {
    const noPort = createIdentityService({
      identity: createInMemoryIdentityStores(),
      registrations,
      nowMs: () => clock,
    });
    const e = await err(() =>
      noPort.actors.resolveOrCreate(W_A, { passportTokenId: "pass_1" }),
    );
    expect(e.code).toBe("INVALID");
  });

  it("M-1: clearing the passport downgrades REGISTERED_USER", async () => {
    passportOwners.set("p1", W_A);
    await svc.actors.resolveOrCreate(W_A, { passportTokenId: "p1" });
    const a = await svc.actors.resolveOrCreate(W_A);
    expect(a.type).toBe("REGISTERED_USER");
    // Passport transferred away → proof gone → downgrade.
    passportOwners.set("p1", W_B);
    const b = await svc.actors.resolveOrCreate(W_A);
    expect(b.type).toBe("EXTERNAL_AGENT");
    // Clearing the link also downgrades.
    passportOwners.set("p1", W_A);
    const c = await svc.actors.enrich(W_A, { passportTokenId: null });
    expect(c.type).toBe("EXTERNAL_AGENT");
    expect(c.passportTokenId).toBeNull();
  });

  it("H-1: agentId write requires an owned ACTIVE registration", async () => {
    // ag-1 belongs to W_B → W_A cannot claim it.
    await registerAgent("ag-1", W_B);
    const e = await err(() => svc.actors.enrich(W_A, { agentId: "ag-1" }));
    expect(e.code).toBe("INVALID");
    // Owned registration → accepted.
    await registerAgent("ag-2", W_A);
    const a = await svc.actors.enrich(W_A, { agentId: "ag-2" });
    expect(a.agentId).toBe("ag-2");
    // Clearing is always allowed.
    const cleared = await svc.actors.enrich(W_A, { agentId: null });
    expect(cleared.agentId).toBeNull();
  });

  it("H-1: ORGANIZATION hint requires orgId", async () => {
    const e = await err(() =>
      svc.actors.resolveOrCreate(W_A, { type: "ORGANIZATION" }),
    );
    expect(e.code).toBe("INVALID");
    const a = await svc.actors.resolveOrCreate(W_A, {
      type: "ORGANIZATION",
      orgId: "org:acme",
    });
    expect(a.type).toBe("ORGANIZATION");
  });

  it("AgentRegistration outranks passport → REGISTERED_AGENT", async () => {
    await registerAgent("eip155:5042002:0xreg:7", W_A);
    passportOwners.set("pass_123", W_A);
    const a = await svc.actors.resolveOrCreate(W_A, {
      passportTokenId: "pass_123",
    });
    expect(a.type).toBe("REGISTERED_AGENT");
  });

  it("revoked registration does not promote to REGISTERED_AGENT", async () => {
    await registrations.put({
      agentId: "eip155:5042002:0xreg:8",
      registryAddress: "0x00000000000000000000000000000000000000aa",
      registryTx: `0x${"cd".repeat(32)}`,
      name: "agent-8",
      keyHash: "k".repeat(64),
      tier: "observer",
      status: "revoked",
      createdAt: clock,
      owner: W_A,
    });
    const a = await svc.actors.resolveOrCreate(W_A);
    expect(a.type).toBe("EXTERNAL_AGENT");
  });

  it("registered type stays while its proof verifies", async () => {
    passportOwners.set("p1", W_A);
    await svc.actors.resolveOrCreate(W_A, { passportTokenId: "p1" });
    const a = await svc.actors.resolveOrCreate(W_A);
    expect(a.type).toBe("REGISTERED_USER");
  });

  it("enrich merges links; undefined keeps, null clears", async () => {
    await svc.actors.resolveOrCreate(W_A, { did: "did:web:x", tier: "gold" });
    await registerAgent("ag-1", W_A);
    const a = await svc.actors.enrich(W_A, { agentId: "ag-1" });
    expect(a.did).toBe("did:web:x");
    expect(a.agentId).toBe("ag-1");
    const b = await svc.actors.enrich(W_A, { did: null });
    expect(b.did).toBeNull();
  });

  it("rejects malformed wallets", async () => {
    const e = await err(() => svc.actors.resolveOrCreate("0xZZZ"));
    expect(e.code).toBe("INVALID");
  });
});

// ---------- entitlement service ----------

describe("entitlement service", () => {
  it("grant activates an ACTIVE row", async () => {
    const { row, deduped } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    expect(deduped).toBe(false);
    expect(row.status).toBe("ACTIVE");
    expect(row.activeSlot).toBe(`${W_A}|PASSPORT_BRONZE`);
    expect(row.idempotencyKey).toBe("pay_1|PASSPORT_BRONZE");
  });

  it("grant is idempotent via idempotencyKey", async () => {
    const first = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const replay = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    expect(replay.deduped).toBe(true);
    expect(replay.row.id).toBe(first.row.id);
  });

  it("second purchase for same (owner, code) dedupes to existing ACTIVE", async () => {
    const first = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "API_ACCESS_STANDARD",
      sourcePaymentId: "pay_1",
    });
    const second = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "API_ACCESS_STANDARD",
      sourcePaymentId: "pay_2",
    });
    expect(second.deduped).toBe(true);
    expect(second.row.id).toBe(first.row.id);
  });

  it("different productCode gets its own ACTIVE slot", async () => {
    await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_SILVER",
      sourcePaymentId: "pay_2",
    });
    expect(row.productCode).toBe("PASSPORT_SILVER");
  });

  it("rejects non-catalog productCode and missing idempotency key", async () => {
    const e1 = await err(() =>
      svc.entitlements.grant({ ownerId: W_A, productCode: "DIRECTORY_LISTING" }),
    );
    expect(e1.code).toBe("INVALID");
    const e2 = await err(() =>
      svc.entitlements.grant({
        ownerId: W_A,
        productCode: "PASSPORT_BRONZE",
        sourcePaymentId: "pay_x",
        idempotencyKey: "short",
      }),
    );
    expect(e2.code).toBe("INVALID");
    const e3 = await err(() =>
      svc.entitlements.grant({
        ownerId: W_A,
        productCode: "PASSPORT_BRONZE",
      }),
    );
    expect(e3.code).toBe("INVALID");
  });

  it("expire/revoke are ACTIVE-only guarded transitions", async () => {
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const expired = await svc.entitlements.expire(row.id);
    expect(expired.status).toBe("EXPIRED");
    expect(expired.activeSlot).toBeNull();
    const e = await err(() => svc.entitlements.revoke(row.id));
    expect(e.code).toBe("CONFLICT");

    const { row: r2 } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "READINESS_BASIC",
      sourcePaymentId: "pay_2",
    });
    const revoked = await svc.entitlements.revoke(r2.id);
    expect(revoked.status).toBe("REVOKED");
  });

  it("expired slot frees a new grant for the same pair", async () => {
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    await svc.entitlements.expire(row.id);
    const { row: next } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_2",
    });
    expect(next.status).toBe("ACTIVE");
    expect(next.id).not.toBe(row.id);
  });

  it("check() returns ACTIVE row and lazily expires overdue ones", async () => {
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
      validUntilMs: clock + 10_000,
    });
    const hit = await svc.entitlements.check(W_A, "PASSPORT_BRONZE");
    expect(hit?.id).toBe(row.id);
    expect(await svc.entitlements.check(W_A, "PASSPORT_GOLD")).toBeNull();

    clock += 20_000; // past validUntil
    expect(await svc.entitlements.check(W_A, "PASSPORT_BRONZE")).toBeNull();
    const stored = await svc.entitlements.getById(row.id);
    expect(stored?.status).toBe("EXPIRED");
  });

  it("perpetual grants (no validUntil) keep passing check()", async () => {
    await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "MARKETPLACE_PARTICIPANT",
      sourcePaymentId: "pay_1",
    });
    clock += 365 * 24 * 3600 * 1000;
    const hit = await svc.entitlements.check(W_A, "MARKETPLACE_PARTICIPANT");
    expect(hit?.status).toBe("ACTIVE");
  });

  it("listByOwner filters by status/productCode", async () => {
    await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
    });
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_SILVER",
      sourcePaymentId: "pay_2",
    });
    await svc.entitlements.revoke(row.id);
    const all = await svc.entitlements.listByOwner(W_A);
    expect(all).toHaveLength(2);
    const revoked = await svc.entitlements.listByOwner(W_A, {
      status: "REVOKED",
    });
    expect(revoked).toHaveLength(1);
  });
});

// ---------- sweeper ----------

describe("entitlement sweeper", () => {
  it("grants from a CONFIRMED payment for a catalog product", async () => {
    await confirmedPayment({ customerId: W_A });
    const r = await svc.sweep({ sinceMs: 0 });
    expect(r.candidates).toBe(1);
    expect(r.granted).toBe(1);
    const e = await svc.entitlements.check(W_A, "PASSPORT_BRONZE");
    expect(e?.status).toBe("ACTIVE");
    expect(e?.sourcePaymentId).toMatch(/^pay_/);
  });

  it("repeat ticks are idempotent — no duplicate rows", async () => {
    await confirmedPayment({ customerId: W_A });
    const first = await svc.sweep({ sinceMs: 0 });
    const second = await svc.sweep({ sinceMs: 0 });
    expect(first.granted).toBe(1);
    expect(second.granted).toBe(0);
    expect(second.deduped).toBe(1);
    const all = await svc.entitlements.listByOwner(W_A);
    expect(all).toHaveLength(1);
  });

  it("skips non-eligible products and non-wallet owners", async () => {
    await confirmedPayment({ customerId: W_A, productId: "DIRECTORY_LISTING" });
    await confirmedPayment({ customerId: "email@example.com" });
    await confirmedPayment({ customerId: W_B, status: "PENDING" });
    const r = await svc.sweep({ sinceMs: 0 });
    expect(r.granted).toBe(0);
    expect(r.skipped.length).toBeGreaterThanOrEqual(2);
    // CONFIRMED attempt for the PENDING payment also reports a skip.
    const reasons = r.skipped.map((s) => s.reason).join("|");
    expect(reasons).toContain("not entitlement-eligible");
    expect(reasons).toContain("no resolvable owner");
    expect(reasons).toContain("status PENDING");
  });

  it("expires overdue ACTIVE rows in the same tick", async () => {
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      sourcePaymentId: "pay_1",
      validUntilMs: clock + 100,
    });
    clock += 1000;
    const r = await svc.sweep({ sinceMs: 0 });
    expect(r.expired).toBe(1);
    const stored = await svc.entitlements.getById(row.id);
    expect(stored?.status).toBe("EXPIRED");
  });

  it("H-4: deduped replays do not consume the maxGrants cap", async () => {
    await confirmedPayment({ customerId: W_A });
    await svc.sweep({ sinceMs: 0 }); // first tick grants
    await confirmedPayment({ customerId: W_B });
    // maxGrants=1: the deduped replay of the first payment must not
    // starve the new one.
    const r = await svc.sweep({ sinceMs: 0, maxGrants: 1 });
    expect(r.deduped).toBe(1);
    expect(r.granted).toBe(1);
  });

  it("H-5: reversal pass revokes grants whose payment lost CONFIRMED", async () => {
    const pay = await confirmedPayment({ customerId: W_A });
    const first = await svc.sweep({ sinceMs: 0 });
    expect(first.granted).toBe(1);
    expect(
      await svc.entitlements.check(W_A, "PASSPORT_BRONZE"),
    ).not.toBeNull();
    // Refund/chargeback — payment leaves CONFIRMED.
    await payments.payments.applyStatus(
      pay.id,
      "CONFIRMED",
      "REFUNDED",
      clock,
    );
    const r = await svc.sweep({ sinceMs: 0 });
    expect(r.revoked).toBe(1);
    expect(await svc.entitlements.check(W_A, "PASSPORT_BRONZE")).toBeNull();
    // And the revoked row's dedupe key blocks re-activation.
    const third = await svc.sweep({ sinceMs: 0 });
    expect(third.granted + third.deduped).toBe(0);
  });

  it("M-4: sweep lazy-creates the grantee actor row", async () => {
    await confirmedPayment({ customerId: W_A });
    await svc.sweep({ sinceMs: 0 });
    const actor = await svc.actors.get(W_A);
    expect(actor?.type).toBe("EXTERNAL_AGENT");
  });

  it("C-2: declared catalog price/currency binds the payment", async () => {
    const { ENTITLEMENT_PRODUCTS } = await import(
      "../src/server/lib/identity/types.js"
    );
    const entry = ENTITLEMENT_PRODUCTS.find(
      (e) => e.productCode === "PASSPORT_BRONZE",
    )!;
    (entry as { minAmount?: string; currency?: string }).minAmount = "9.99";
    entry.currency = "USD";
    try {
      // Underpayment → skipped, no grant.
      const cheap = await confirmedPayment({
        customerId: W_A,
        amount: "0.01",
      });
      // Full price → grant.
      const fair = await confirmedPayment({
        customerId: W_B,
        amount: "9.99",
      });
      const r = await svc.sweep({ sinceMs: 0 });
      expect(r.granted).toBe(1);
      expect(r.skippedCount).toBeGreaterThanOrEqual(1);
      expect(await svc.entitlements.check(W_A, "PASSPORT_BRONZE")).toBeNull();
      expect(
        await svc.entitlements.check(W_B, "PASSPORT_BRONZE"),
      ).not.toBeNull();
      void cheap;
      void fair;
    } finally {
      delete (entry as { minAmount?: string; currency?: string }).minAmount;
      delete (entry as { currency?: string }).currency;
    }
  });

  it("C-2: ownerFor cannot reroute the grant off the payer", async () => {
    await confirmedPayment({ customerId: W_A });
    const evil = createIdentityService({
      identity,
      payments,
      registrations,
      passports,
      ownerFor: () => W_B, // resolver tries to redirect the grant
      nowMs: () => clock,
    });
    const r = await evil.sweep({ sinceMs: 0 });
    expect(r.granted).toBe(0);
    expect(r.errors.some((e) => e.message.includes("customerId"))).toBe(true);
    expect(await svc.entitlements.check(W_B, "PASSPORT_BRONZE")).toBeNull();
  });

  it("M-2: idempotencyKey hit for a different pair conflicts", async () => {
    await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      idempotencyKey: "shared_key_123",
    });
    const e = await err(() =>
      svc.entitlements.grant({
        ownerId: W_B,
        productCode: "PASSPORT_SILVER",
        idempotencyKey: "shared_key_123",
      }),
    );
    expect(e.code).toBe("CONFLICT");
  });

  it("M-5: stored rows don't share caller payload references", async () => {
    const payload = { note: "orig" };
    const { row } = await svc.entitlements.grant({
      ownerId: W_A,
      productCode: "PASSPORT_BRONZE",
      idempotencyKey: "m5_payload_key",
      payload,
    });
    payload.note = "mutated";
    const stored = await svc.entitlements.getById(row.id);
    expect((stored?.payload as { note: string }).note).toBe("orig");
  });
});

// ---------- fact emitters ----------

describe("reputation fact emitters", () => {
  it("typed emitters write the right factType + sourceRef", async () => {
    const f1 = await svc.facts.taskCompleted(W_A, "ag_1");
    expect(f1?.factType).toBe("TASK_COMPLETED");
    expect(f1?.sourceRef).toBe("agreement:ag_1");
    const f2 = await svc.facts.submissionAccepted(W_A, "sub_1");
    expect(f2?.factType).toBe("SUBMISSION_ACCEPTED");
    const f3 = await svc.facts.evidenceSupplied(W_A, "ev_1");
    expect(f3?.factType).toBe("EVIDENCE_SUPPLIED");
    // H-3: paymentVerified refs are proven against the payments
    // store — needs a real CONFIRMED payment owned by the actor.
    const pay = await confirmedPayment({ customerId: W_A });
    const f4 = await svc.facts.paymentVerified(W_A, pay.id);
    expect(f4?.factType).toBe("PAYMENT_VERIFIED");
    const f5 = await svc.facts.dispute(W_A, "ag_2");
    expect(f5?.factType).toBe("DISPUTE");
    const f6 = await svc.facts.attestation(W_A, "att_1");
    expect(f6?.factType).toBe("ATTESTATION");
  });

  it("dedupeKey collapses replays", async () => {
    const first = await svc.facts.taskCompleted(W_A, "ag_1");
    const replay = await svc.facts.taskCompleted(W_A, "ag_1");
    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    const list = await svc.facts.listByActor(W_A);
    expect(list).toHaveLength(1);
  });

  it("same subject for different actors is not a collision", async () => {
    await svc.facts.taskCompleted(W_A, "ag_1");
    const other = await svc.facts.taskCompleted(W_B, "ag_1");
    expect(other).not.toBeNull();
  });

  it("countsByActor + listByActor filter by factType", async () => {
    await svc.facts.taskCompleted(W_A, "ag_1");
    await svc.facts.taskCompleted(W_A, "ag_2");
    await svc.facts.dispute(W_A, "ag_3");
    const counts = await svc.facts.countsByActor(W_A);
    expect(counts.TASK_COMPLETED).toBe(2);
    expect(counts.DISPUTE).toBe(1);
    const tasks = await svc.facts.listByActor(W_A, {
      factType: "TASK_COMPLETED",
    });
    expect(tasks).toHaveLength(2);
  });

  it("H-3: emit rejects unverifiable sourceRefs", async () => {
    // payment: refs must point at a CONFIRMED payment paid by the
    // actor — nonexistent, another payer, or non-CONFIRMED fail.
    const ghost = await err(() =>
      svc.facts.emit({
        actorWallet: W_A,
        factType: "PAYMENT_VERIFIED",
        sourceRef: "payment:does-not-exist",
      }),
    );
    expect(ghost.code).toBe("INVALID");
    const others = await confirmedPayment({ customerId: W_B });
    const stolen = await err(() =>
      svc.facts.emit({
        actorWallet: W_A,
        factType: "PAYMENT_VERIFIED",
        sourceRef: `payment:${others.id}`,
      }),
    );
    expect(stolen.code).toBe("INVALID");
    // Non-payment refs pass through (no verifier configured yet).
    const ok = await svc.facts.emit({
      actorWallet: W_A,
      factType: "TASK_COMPLETED",
      sourceRef: "agreement:ag_9",
      subjectId: "ag_9",
    });
    expect(ok?.sourceRef).toBe("agreement:ag_9");
  });

  it("H-3: atMs may not be future-dated", async () => {
    const e = await err(() =>
      svc.facts.emit({
        actorWallet: W_A,
        factType: "ATTESTATION",
        sourceRef: "attestation:x",
        atMs: clock + 10 * 60_000,
      }),
    );
    expect(e.code).toBe("INVALID");
  });

  it("rejects empty sourceRef and bad wallet", async () => {
    const e1 = await err(() =>
      svc.facts.emit({
        actorWallet: W_A,
        factType: "TASK_COMPLETED",
        sourceRef: "",
      }),
    );
    expect(e1.code).toBe("INVALID");
    const e2 = await err(() =>
      svc.facts.emit({
        actorWallet: "0xNOPE",
        factType: "TASK_COMPLETED",
        sourceRef: "x",
      }),
    );
    expect(e2.code).toBe("INVALID");
  });
});
