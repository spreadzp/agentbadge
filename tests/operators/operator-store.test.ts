import { describe, expect, it } from "vitest";

import {
  ADMIN_CAPABILITIES,
  adminKeyPrefix,
  createMemoryOperatorStore,
  generateAdminKeyPlaintext,
  hashAdminKey,
  isAdminKeyPlaintext,
  pickOperatorStores,
  type OperatorStore,
} from "../../src/server/lib/operators";

/**
 * SLICE-264-1 contract test — the memory backend exercises the same
 * OperatorStore semantics the Postgres adapter implements
 * (packages/database tests/admin-operators.test.ts is the PG-side
 * mirror): operator ≠ credential separation (C1/C11), closed
 * capability/principalType vocab, hash-only key persistence, honest
 * ok:false signals, idempotent revoke/disable, C5 count seam.
 *
 * D-143: DATABASE_ENABLED=off serves through this fallback
 * (pickOperatorStores on a facade without the group → memory).
 */

import { generateReportId } from "../../src/agent-readiness/integrity/ulid";

let n = 0;
const id = (p: string) => `${p}_${generateReportId()}`;

const mkOp = (s: OperatorStore, type = "human") =>
  s.createOperator({
    id: id("op"),
    displayName: `Op ${n}`,
    principalType: type,
    capabilities: ["read", "workflow"],
  });

const issue = (s: OperatorStore, operatorId: string, plaintext?: string) => {
  const key = plaintext ?? generateAdminKeyPlaintext();
  return s.issueCredential({
    id: id("opc"),
    operatorId,
    keyHash: hashAdminKey(key),
    keyPrefix: adminKeyPrefix(key),
  });
};

describe("operator store contract (memory backend)", () => {
  it("createOperator validates id/type/capability vocab", async () => {
    const s = createMemoryOperatorStore();
    const bad1 = await s.createOperator({
      id: "not-an-op-id",
      displayName: "x",
      principalType: "human",
      capabilities: ["read"],
    });
    expect(bad1).toEqual({ ok: false, reason: "invalid_id" });

    const bad2 = await s.createOperator({
      id: id("op"),
      displayName: "x",
      principalType: "superuser",
      capabilities: ["read"],
    });
    expect(bad2).toEqual({ ok: false, reason: "invalid_principal_type" });

    const bad3 = await s.createOperator({
      id: id("op"),
      displayName: "x",
      principalType: "human",
      capabilities: ["read", "god-mode"],
    });
    expect(bad3).toEqual({ ok: false, reason: "invalid_capability" });
    expect(ADMIN_CAPABILITIES).toContain("workflow");

    const op = await mkOp(s);
    expect(op.ok).toBe(true);
    const dup = await s.createOperator({
      id: op.ok ? op.operator.id : "",
      displayName: "x",
      principalType: "human",
      capabilities: ["read"],
    });
    expect(dup).toEqual({ ok: false, reason: "duplicate_id" });
  });

  it("operator ≠ credential: revoke/rotate never rewrites identity (C1/C11)", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkOp(s);
    if (!op.ok) throw new Error("seed failed");
    const c1 = await issue(s, op.operator.id);
    const c2 = await issue(s, op.operator.id);
    expect(c1.ok && c2.ok).toBe(true);
    expect(
      (await s.listCredentialsForOperator(op.operator.id)).length,
    ).toBe(2);
    await s.revokeCredential(c1.ok ? c1.credential.id : "");
    expect((await s.getOperator(op.operator.id))!.status).toBe("active");
    expect((await s.listCredentialsForOperator(op.operator.id)).length).toBe(2);
  });

  it("issueCredential refuses missing/disabled operator + duplicate hash", async () => {
    const s = createMemoryOperatorStore();
    expect(await issue(s, `op_${generateReportId()}`)).toEqual({
      ok: false,
      reason: "missing_operator",
    });
    const op = await mkOp(s);
    if (!op.ok) throw new Error("seed failed");
    const key = generateAdminKeyPlaintext();
    const first = await issue(s, op.operator.id, key);
    expect(first.ok).toBe(true);
    // same plaintext → same hash → duplicate refused honestly
    expect(await issue(s, op.operator.id, key)).toEqual({
      ok: false,
      reason: "duplicate_hash",
    });
    await s.disableOperator(op.operator.id);
    expect(await issue(s, op.operator.id)).toEqual({
      ok: false,
      reason: "disabled_operator",
    });
  });

  it("getOperatorByKeyHash returns the (operator, credential) pair", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkOp(s);
    if (!op.ok) throw new Error("seed failed");
    const key = generateAdminKeyPlaintext();
    await issue(s, op.operator.id, key);
    const pair = await s.getOperatorByKeyHash(hashAdminKey(key));
    expect(pair?.operator.id).toBe(op.operator.id);
    expect(pair?.credential.keyPrefix).toBe(adminKeyPrefix(key));
    // plaintext never materialized — only sha256 hex + identification prefix
    expect(JSON.stringify(pair)).not.toContain(key);
    expect(await s.getOperatorByKeyHash(hashAdminKey(generateAdminKeyPlaintext()))).toBeNull();
  });

  it("revoke + disable are idempotent and honest", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkOp(s);
    if (!op.ok) throw new Error("seed failed");
    const cred = await issue(s, op.operator.id);
    if (!cred.ok) throw new Error("seed failed");

    const r1 = await s.revokeCredential(cred.credential.id);
    const r2 = await s.revokeCredential(cred.credential.id);
    expect(r1.ok && r2.ok).toBe(true);
    expect(await s.revokeCredential(`opc_${generateReportId()}`)).toEqual({
      ok: false,
      reason: "missing",
    });

    const d1 = await s.disableOperator(op.operator.id);
    const d2 = await s.disableOperator(op.operator.id);
    expect(d1.ok && d2.ok).toBe(true);
    if (d1.ok) expect(d1.operator.disabledAt).not.toBeNull();
    expect(await s.disableOperator("op_missingxxxxxxxxxxxxxxxx")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("activeHumanCount counts active humans only (C5 seam)", async () => {
    const s = createMemoryOperatorStore();
    expect(await s.activeHumanCount()).toBe(0);
    const h = await mkOp(s, "human");
    await mkOp(s, "service");
    await mkOp(s, "break_glass");
    expect(await s.activeHumanCount()).toBe(1);
    if (h.ok) await s.disableOperator(h.operator.id);
    expect(await s.activeHumanCount()).toBe(0);
  });

  it("listOperators filters by status + principalType", async () => {
    const s = createMemoryOperatorStore();
    const h = await mkOp(s, "human");
    await mkOp(s, "service");
    if (h.ok) await s.disableOperator(h.operator.id);
    expect((await s.listOperators({ principalType: "service" })).length).toBe(1);
    expect((await s.listOperators({ status: "disabled" })).length).toBe(1);
    expect((await s.listOperators()).length).toBe(2);
  });

  it("touchLastUsed sets diagnostics timestamp, false on missing", async () => {
    const s = createMemoryOperatorStore();
    const op = await mkOp(s);
    if (!op.ok) throw new Error("seed failed");
    const cred = await issue(s, op.operator.id);
    if (!cred.ok) throw new Error("seed failed");
    const ts = new Date().toISOString();
    expect(await s.touchLastUsed(cred.credential.id, ts)).toBe(true);
    const pair = await s.getOperatorByKeyHash(cred.credential.keyHash);
    expect(pair?.credential.lastUsedAt).toBe(ts);
    expect(await s.touchLastUsed(`opc_${generateReportId()}`, ts)).toBe(false);
  });

  it("seed fixture pre-fills the memory store", async () => {
    const key = generateAdminKeyPlaintext();
    const seedOpId = `op_${generateReportId()}`;
    const s = createMemoryOperatorStore({
      operators: [
        {
          id: seedOpId,
          displayName: "Seed",
          principalType: "human",
          capabilities: ["read"],
          status: "active",
          createdAt: new Date().toISOString(),
          disabledAt: null,
        },
      ],
      credentials: [
        {
          id: `opc_${generateReportId()}`,
          operatorId: seedOpId,
          keyHash: hashAdminKey(key),
          keyPrefix: adminKeyPrefix(key),
          status: "active",
          issuedAt: new Date().toISOString(),
          revokedAt: null,
          lastUsedAt: null,
        },
      ],
    });
    expect(await s.activeHumanCount()).toBe(1);
    expect(
      (await s.getOperatorByKeyHash(hashAdminKey(key)))?.operator.displayName,
    ).toBe("Seed");
  });

  it("opk_ plaintext shape + hash/prefix helpers", () => {
    const key = generateAdminKeyPlaintext();
    expect(isAdminKeyPlaintext(key)).toBe(true);
    expect(isAdminKeyPlaintext("abop_wrong")).toBe(false);
    expect(isAdminKeyPlaintext("opk_short")).toBe(false);
    expect(hashAdminKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(adminKeyPrefix(key)).toHaveLength(12);
    expect(adminKeyPrefix(key).startsWith("opk_")).toBe(true);
  });

  it("pickOperatorStores falls back to a shared memory singleton", () => {
    const a = pickOperatorStores({});
    const b = pickOperatorStores({ adminOperators: null });
    expect(a.backend).toBe("memory");
    expect(a).toBe(b); // singleton — writers and readers share maps
  });
});
