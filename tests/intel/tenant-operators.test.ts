// EPIC-262 (SLICE-262-7): tenant onboarding — operators are humans on
// a tenant with roles (owner|operator|viewer), authenticated by an
// abop_ key. Tenant-scoped, never site-scoped: site owner ≠ operator
// ≠ tenant (EXPLAINED §0, D-262-Q7).
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
  type IntelRegistryService,
} from "../../src/server/lib/intel/registry";
import {
  authenticateOperator,
  inviteOperator,
  listOperators,
  revokeOperator,
  rolePermitted,
} from "../../src/server/lib/intel/registry/operators";
import { isOperatorKeyPlaintext } from "../../src/server/lib/intel/registry/operator-key";

let stores: IntelRegistryStores;
let svc: IntelRegistryService;
let tenantId: string;
let otherTenantId: string;

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  svc = createIntelRegistryService(stores);
  tenantId = (await svc.createTenant({ slug: "pryme", name: "P" })).id;
  otherTenantId = (
    await svc.createTenant({ slug: "rival", name: "R" })
  ).id;
});

describe("inviteOperator", () => {
  it("returns abop_ plaintext once; only hash+prefix persist", async () => {
    const { plaintext, record } = await inviteOperator(stores, tenantId, {
      email: "Op@Pryme.io",
      role: "operator",
    });
    expect(isOperatorKeyPlaintext(plaintext)).toBe(true);
    expect(record.id).toMatch(/^op_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(record.email).toBe("op@pryme.io"); // normalized
    expect(record.status).toBe("active");
    // plaintext never persisted — hash+prefix only
    expect(record.keyHash).toBe(
      createHash("sha256").update(plaintext).digest("hex"),
    );
    expect(record.keyPrefix).toBe(plaintext.slice(0, 13));
    expect(JSON.stringify(record)).not.toContain(plaintext);
  });

  it("rejects unknown tenant / bad email / duplicate active email", async () => {
    await expect(
      inviteOperator(stores, "op_missing", {
        email: "a@b.io",
        role: "viewer",
      }),
    ).rejects.toThrow("tenant not found");
    await expect(
      inviteOperator(stores, tenantId, { email: "nope", role: "viewer" }),
    ).rejects.toThrow("valid email");
    await inviteOperator(stores, tenantId, {
      email: "dup@pryme.io",
      role: "viewer",
    });
    await expect(
      inviteOperator(stores, tenantId, {
        email: "DUP@pryme.io",
        role: "operator",
      }),
    ).rejects.toThrow("already");
  });

  it("re-invite after revoke is allowed (new key, same email)", async () => {
    const first = await inviteOperator(stores, tenantId, {
      email: "back@pryme.io",
      role: "viewer",
    });
    await revokeOperator(stores, first.record.id);
    const second = await inviteOperator(stores, tenantId, {
      email: "back@pryme.io",
      role: "operator",
    });
    expect(second.record.id).not.toBe(first.record.id);
    expect(second.record.role).toBe("operator");
  });
});

describe("authenticateOperator", () => {
  it("active key → {operator_id, tenant_id, role}", async () => {
    const { plaintext, record } = await inviteOperator(stores, tenantId, {
      email: "op@pryme.io",
      role: "operator",
    });
    const ctx = await authenticateOperator(stores, plaintext);
    expect(ctx).toEqual({
      operator_id: record.id,
      tenant_id: tenantId,
      role: "operator",
    });
  });

  it("revoked, unknown, malformed → null", async () => {
    const { plaintext, record } = await inviteOperator(stores, tenantId, {
      email: "gone@pryme.io",
      role: "operator",
    });
    await revokeOperator(stores, record.id);
    expect(await authenticateOperator(stores, plaintext)).toBeNull();
    expect(await authenticateOperator(stores, "abop_notakey")).toBeNull();
    expect(await authenticateOperator(stores, "abop_" + "a".repeat(32))).toBeNull();
    // a site key is NOT an operator credential
    expect(await authenticateOperator(stores, "absk_" + "a".repeat(32))).toBeNull();
  });
});

describe("revoke / list", () => {
  it("revoke is idempotent; list is tenant-scoped", async () => {
    const a = await inviteOperator(stores, tenantId, {
      email: "a@pryme.io",
      role: "owner",
    });
    await inviteOperator(stores, tenantId, {
      email: "b@pryme.io",
      role: "viewer",
    });
    await inviteOperator(stores, otherTenantId, {
      email: "spy@rival.io",
      role: "owner",
    });
    const list = await listOperators(stores, tenantId);
    expect(list.map((o) => o.email).sort()).toEqual([
      "a@pryme.io",
      "b@pryme.io",
    ]);
    const revoked = await revokeOperator(stores, a.record.id);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeTruthy();
    const again = await revokeOperator(stores, a.record.id);
    expect(again.revokedAt).toBe(revoked.revokedAt);
    await expect(revokeOperator(stores, "op_missing")).rejects.toThrow(
      "operator not found",
    );
  });
});

describe("rolePermitted — backend-enforced role gate", () => {
  it("viewer is read-only; owner/operator run paid ops", () => {
    expect(rolePermitted("viewer", "deep_scan")).toBe(false);
    expect(rolePermitted("viewer", "fix_apply")).toBe(false);
    expect(rolePermitted("owner", "deep_scan")).toBe(true);
    expect(rolePermitted("operator", "deep_scan")).toBe(true);
    expect(rolePermitted("owner", "nonsense_op")).toBe(false);
  });
});
