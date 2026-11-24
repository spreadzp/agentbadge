// EPIC-262 (SLICE-262-7): operator domain ops — humans attached to a
// tenant with roles (owner|operator|viewer). The operator key is a
// TENANT-scoped credential: site owner ≠ operator ≠ tenant.
// Kept outside service.ts (file is at its line budget) — the service
// delegates to these store-level ops, so memory and Postgres adapters
// share identical behavior.
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { IntelRegistryStores } from "./store";
import {
  generateOperatorKeyPlaintext,
  hashOperatorKey,
  isOperatorKeyPlaintext,
  operatorKeyPrefix,
} from "./operator-key";
import type {
  IntelOperator,
  OperatorAuthContext,
  OperatorRole,
} from "./types";

const uid = (prefix: string) => `${prefix}_${generateReportId()}`;
const now = () => new Date().toISOString();

// Role → allowed paid ops. viewer is read-only: no paid operation at
// all. owner and operator run the same ops in v1 — the distinction is
// audit/invite authority, not op surface (invites land with dashboard).
export function rolePermitted(role: OperatorRole, op: string): boolean {
  if (role === "viewer") return false;
  return [
    "deep_scan",
    "inside_diagnostics",
    "fix_apply",
    "ownership_verify",
    "consent",
  ].includes(op);
}

export async function inviteOperator(
  stores: IntelRegistryStores,
  tenantId: string,
  input: { email: string; role: OperatorRole },
): Promise<{ plaintext: string; record: IntelOperator }> {
  if (!(await stores.tenants.byId(tenantId))) {
    throw new Error(`tenant not found: ${tenantId}`);
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("operator email must be a valid email address");
  }
  const existing = await stores.operators.forTenant(tenantId);
  if (existing.some((o) => o.email === email && o.status === "active")) {
    throw new Error(`active operator already exists for ${email}`);
  }
  const plaintext = generateOperatorKeyPlaintext();
  const record = await stores.operators.insert({
    id: uid("op"),
    tenantId,
    email,
    role: input.role,
    status: "active",
    keyHash: hashOperatorKey(plaintext),
    keyPrefix: operatorKeyPrefix(plaintext),
    createdAt: now(),
    revokedAt: null,
  });
  return { plaintext, record };
}

export async function authenticateOperator(
  stores: IntelRegistryStores,
  plaintext: string,
): Promise<OperatorAuthContext | null> {
  if (!isOperatorKeyPlaintext(plaintext)) return null;
  const op = await stores.operators.byKeyHash(hashOperatorKey(plaintext));
  if (!op || op.status !== "active") return null;
  return { operator_id: op.id, tenant_id: op.tenantId, role: op.role };
}

export async function revokeOperator(
  stores: IntelRegistryStores,
  operatorId: string,
): Promise<IntelOperator> {
  const op = await stores.operators.byId(operatorId);
  if (!op) throw new Error(`operator not found: ${operatorId}`);
  if (op.status === "revoked") return op;
  return stores.operators.update({
    ...op,
    status: "revoked",
    revokedAt: now(),
  });
}

export function listOperators(
  stores: IntelRegistryStores,
  tenantId: string,
): Promise<IntelOperator[]> {
  return stores.operators.forTenant(tenantId);
}
