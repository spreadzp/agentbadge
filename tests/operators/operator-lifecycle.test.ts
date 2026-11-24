import { describe, expect, it } from "vitest";

import {
  applyOperatorSeed,
  createMemoryOperatorStore,
  createOperator,
  generateAdminKeyPlaintext,
  hashAdminKey,
  isOperatorName,
  issueOperatorCredential,
  normalizeOperatorName,
  rotateOperatorCredential,
  seedOperatorsFromEnv,
  type OperatorStore,
} from "../../src/server/lib/operators";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";

/**
 * SLICE-264-3 contract test — credential lifecycle + one-shot seed.
 *
 * DoD legs: agent-shaped/unicode-lookalike names refused at CREATION
 * (D-264-Q16 — the request guard is gone, the domain layer owns it);
 * revoked → dead immediately, operator row stays for audit; rotate =
 * new key works + old dead + principal.id unchanged (C11); C5 guard
 * blocks revoking/disabling the last active human's access; seed is
 * create-if-absent and never resurrects or overwrites (C9).
 */

const opId = () => `op_${generateReportId()}`;

const mkHuman = (s: OperatorStore, name = "alice") =>
  createOperator(s, {
    displayName: name,
    principalType: "human",
    capabilities: ["read", "workflow"],
  });

describe("operator name validation — D-264-Q16 (was isOperatorRef)", () => {
  it("canonicalizes NFKC+lowercase and refuses lookalikes/agent shapes", async () => {
    const s = createMemoryOperatorStore();
    // canonicalization: capitals + fullwidth collapse to the same ref
    expect(normalizeOperatorName("  Alice ")).toBe("alice");
    expect(normalizeOperatorName("ＡＬＩＣＥ")).toBe("alice");
    expect(isOperatorName("alice.smith-1")).toBe(true);
    expect(isOperatorName("a_b-c@d")).toBe(true);
    // agent-shaped / machine refs refused
    for (const bad of [
      "bot",
      "bot1",
      "svc-x",
      "agt_k",
      "did:example",
      "agent-007",
      "key2",
      "", // empty after normalize
      "a".repeat(81), // over 80
      "uni\u200Bcode", // zero-width space — not in charset
      "кириллица", // Cyrillic lookalike — not in charset
      "has space",
      "UPPER only fine", // has space → refused anyway
    ]) {
      expect(isOperatorName(bad), bad).toBe(false);
    }
    const res = await createOperator(s, {
      displayName: "bot-9000",
      principalType: "human",
      capabilities: ["read"],
    });
    expect(res).toEqual({ ok: false, reason: "invalid_display_name" });
  });

  it("displayName uniqueness is canonical — 'Alice' vs 'ａｌｉｃｅ' collide", async () => {
    const s = createMemoryOperatorStore();
    expect((await mkHuman(s, "Alice")).ok).toBe(true);
    expect(await mkHuman(s, "ａｌｉｃｅ")).toEqual({
      ok: false,
      reason: "duplicate_display_name",
    });
    const stored = (await s.listOperators())[0];
    expect(stored.displayName).toBe("alice"); // canonical form stored
  });
});

describe("credential lifecycle — C1/C11", () => {
  it("issue returns plaintext once; store holds hash+prefix only", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkHuman(s);
    if (!op.ok) throw new Error("seed failed");
    const issued = await issueOperatorCredential(s, op.operator.id);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.key).toMatch(/^opk_[A-Za-z0-9_-]{32}$/);
    // plaintext never materialized into the row
    expect(JSON.stringify(issued.credential)).not.toContain(issued.key);
    expect(issued.credential.keyHash).toBe(hashAdminKey(issued.key));
    expect(issued.key.startsWith(issued.credential.keyPrefix)).toBe(true);
    // issue on missing operator → honest refusal
    expect(await issueOperatorCredential(s, opId())).toEqual({
      ok: false,
      reason: "missing_operator",
    });
  });

  it("rotate: new key works, old dead, principal.id unchanged (C11)", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkHuman(s);
    if (!op.ok) throw new Error("seed failed");
    const first = await issueOperatorCredential(s, op.operator.id);
    if (!first.ok) throw new Error("seed failed");

    const rotated = await rotateOperatorCredential(
      s,
      op.operator.id,
      first.credential.id,
    );
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.credential.operatorId).toBe(op.operator.id);
    expect(rotated.revoked.status).toBe("revoked");
    expect(rotated.revoked.revokedAt).not.toBeNull();
    expect(rotated.key).not.toBe(first.key);
    // identity untouched — principal.id is the same op_<ulid>
    const pair = await s.getOperatorByKeyHash(hashAdminKey(rotated.key));
    expect(pair?.operator.id).toBe(op.operator.id);
    // the old hash still resolves the ROW (audit) but is revoked
    const oldPair = await s.getOperatorByKeyHash(
      hashAdminKey(first.key),
    );
    expect(oldPair?.credential.status).toBe("revoked");
    // refuses on missing/revoked targets
    expect(
      await rotateOperatorCredential(s, op.operator.id, "opc_missing"),
    ).toEqual({ ok: false, reason: "missing_credential" });
    expect(
      await rotateOperatorCredential(
        s,
        op.operator.id,
        rotated.revoked.id,
      ),
    ).toEqual({ ok: false, reason: "already_revoked" });
    expect(await rotateOperatorCredential(s, opId(), "opc_x")).toEqual({
      ok: false,
      reason: "missing_operator",
    });
  });

  it("revoked credential is dead but the operator row stays (audit)", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkHuman(s);
    const other = await mkHuman(s, "bob"); // bearer → C5 stays free
    if (!op.ok || !other.ok) throw new Error("seed failed");
    const otherCred = await issueOperatorCredential(s, other.operator.id);
    if (!otherCred.ok) throw new Error("seed failed");
    const cred = await issueOperatorCredential(s, op.operator.id);
    if (!cred.ok) throw new Error("seed failed");
    const r = await s.revokeCredential(cred.credential.id);
    expect(r.ok).toBe(true);
    const pair = await s.getOperatorByKeyHash(hashAdminKey(cred.key));
    expect(pair?.credential.status).toBe("revoked");
    expect(pair?.operator.status).toBe("active"); // audit row intact
  });
});

describe("C5 last-operator guard — at the store layer, unbypassable", () => {
  it("refuses disabling the last access-bearing human", async () => {
    const s = createMemoryOperatorStore();
    const only = await mkHuman(s);
    if (!only.ok) throw new Error("seed failed");
    // cred-less human can be disabled even when alone — nothing is lost
    expect((await s.disableOperator(only.operator.id)).ok).toBe(true);
    await s.enableOperator(only.operator.id);
    // credentialed → now it bears access → sole bearer is guarded
    const cred = await issueOperatorCredential(s, only.operator.id);
    if (!cred.ok) throw new Error("seed failed");
    expect(await s.disableOperator(only.operator.id)).toEqual({
      ok: false,
      reason: "last_operator",
    });
    // a cred-LESS second human does not free the guard (review r2):
    // rows don't authenticate
    const empty = await mkHuman(s, "empty-shell");
    expect(empty.ok).toBe(true);
    expect(await s.disableOperator(only.operator.id)).toEqual({
      ok: false,
      reason: "last_operator",
    });
    // a credentialed second human frees it
    const bob = await mkHuman(s, "bob");
    if (bob.ok) await issueOperatorCredential(s, bob.operator.id);
    expect((await s.disableOperator(only.operator.id)).ok).toBe(true);
  });

  it("refuses revoking the last active cred of the last human; second cred frees it", async () => {
    const s = createMemoryOperatorStore();
    const only = await mkHuman(s);
    if (!only.ok) throw new Error("seed failed");
    const c1 = await issueOperatorCredential(s, only.operator.id);
    const c2 = await issueOperatorCredential(s, only.operator.id);
    if (!c1.ok || !c2.ok) throw new Error("seed failed");
    // two active creds — revoking one is fine
    expect((await s.revokeCredential(c1.credential.id)).ok).toBe(true);
    // now c2 is the last active cred of the last human → guarded
    expect(await s.revokeCredential(c2.credential.id)).toEqual({
      ok: false,
      reason: "last_operator",
    });
    // rotate still works: issue-first means the guard sees a survivor
    const rot = await rotateOperatorCredential(
      s,
      only.operator.id,
      c2.credential.id,
    );
    expect(rot.ok).toBe(true);
  });

  it("service/break_glass principals are not C5-guarded; disable idempotent", async () => {
    const s = createMemoryOperatorStore();
    const svc = await createOperator(s, {
      displayName: "probe-bot",
      principalType: "service",
      capabilities: ["probe"],
    });
    if (!svc.ok) throw new Error("seed failed");
    // no humans at all — service disable is free
    expect((await s.disableOperator(svc.operator.id)).ok).toBe(true);
    expect((await s.disableOperator(svc.operator.id)).ok).toBe(true); // idempotent
    expect(await s.disableOperator(opId())).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("enableOperator restores access + clears disabledAt, idempotent", async () => {
    const s = createMemoryOperatorStore();
    const a = await mkHuman(s);
    const b = await mkHuman(s, "bob");
    if (!a.ok || !b.ok) throw new Error("seed failed");
    await s.disableOperator(a.operator.id);
    expect(
      (await s.getOperator(a.operator.id))?.disabledAt,
    ).not.toBeNull();
    const en = await s.enableOperator(a.operator.id);
    expect(en.ok && en.operator.status).toBe("active");
    expect(en.ok && en.operator.disabledAt).toBeNull();
    expect((await s.enableOperator(a.operator.id)).ok).toBe(true); // idempotent
    expect(await s.enableOperator(opId())).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

describe("OPERATOR_SEED_JSON — one-shot bootstrap (C9)", () => {
  const seedKey = () => generateAdminKeyPlaintext();

  it("seeds a full-capability human on an EMPTY table only", async () => {
    const s = createMemoryOperatorStore();
    const key = seedKey();
    const r = await applyOperatorSeed(s, {
      displayName: "root",
      key,
    });
    expect(r).toMatchObject({ ok: true, seeded: true });
    const op = (await s.listOperators())[0];
    expect(op.principalType).toBe("human");
    expect(op.capabilities.sort()).toEqual(
      ["operator-admin", "probe", "read", "workflow"].sort(),
    );
    // the seeded key authenticates through the store path
    const pair = await s.getOperatorByKeyHash(hashAdminKey(key));
    expect(pair?.operator.id).toBe(op.id);
    // second run — strict no-op (C9)
    expect(
      await applyOperatorSeed(s, { displayName: "mallory", key: seedKey() }),
    ).toEqual({ ok: true, seeded: false, reason: "not_empty" });
    expect((await s.listOperators()).length).toBe(1);
  });

  it("never resurrects: revoked cred + disabled operator stay dead", async () => {
    const s = createMemoryOperatorStore();
    const key = seedKey();
    await applyOperatorSeed(s, { displayName: "root", key });
    const op = (await s.listOperators())[0];
    const creds = await s.listCredentialsForOperator(op.id);
    // seeded root is the SOLE access-bearer — C5 refuses its disable
    expect(await s.disableOperator(op.id)).toEqual({
      ok: false,
      reason: "last_operator",
    });
    // a credentialed second human frees the guard
    const second = await mkHuman(s, "second");
    if (second.ok) await issueOperatorCredential(s, second.operator.id);
    expect((await s.disableOperator(op.id)).ok).toBe(true);
    // disabled operator's creds are revocable (access already dead)
    expect((await s.revokeCredential(creds[0].id)).ok).toBe(true);
    const again = await applyOperatorSeed(s, {
      displayName: "root",
      key: seedKey(),
    });
    expect(again).toEqual({ ok: true, seeded: false, reason: "not_empty" });
    expect((await s.getOperator(op.id))?.status).toBe("disabled");
    expect(
      (await s.listCredentialsForOperator(op.id))[0].status,
    ).toBe("revoked");
  });

  it("resumes a half-seeded operator (cred-less match), never touches foreign", async () => {
    const s = createMemoryOperatorStore();
    // crash between createOperator and issueCredential → cred-less op
    const half = await mkHuman(s, "root");
    if (!half.ok) throw new Error("seed failed");
    const key = seedKey();
    const r = await applyOperatorSeed(s, { displayName: "root", key });
    expect(r).toMatchObject({ ok: true, seeded: true, operatorId: half.operator.id });
    // the seed key authenticates on the pre-existing operator
    const pair = await s.getOperatorByKeyHash(hashAdminKey(key));
    expect(pair?.operator.id).toBe(half.operator.id);
    // a foreign cred-less op does NOT absorb the seed
    const s2 = createMemoryOperatorStore();
    await mkHuman(s2, "mallory");
    expect(
      await applyOperatorSeed(s2, { displayName: "root", key: seedKey() }),
    ).toEqual({ ok: true, seeded: false, reason: "not_empty" });
    expect((await s2.listCredentialsForOperator(
      (await s2.listOperators())[0].id,
    )).length).toBe(0);
  });

  it("refuses malformed input honestly", async () => {
    const s = createMemoryOperatorStore();
    expect(
      await applyOperatorSeed(s, { displayName: "root", key: "not-opk" }),
    ).toMatchObject({ ok: false });
    expect(await seedOperatorsFromEnv(s, "{not json")).toMatchObject({
      ok: false,
      reason: "OPERATOR_SEED_JSON is not valid JSON",
    });
    expect(
      await seedOperatorsFromEnv(s, '{"displayName":"root"}'),
    ).toMatchObject({ ok: false });
    expect(await seedOperatorsFromEnv(s, undefined)).toEqual({
      ok: true,
      seeded: false,
      reason: "not_configured",
    });
    const json = JSON.stringify({ displayName: "root", key: seedKey() });
    expect((await seedOperatorsFromEnv(s, json)).ok).toBe(true);
  });
});
