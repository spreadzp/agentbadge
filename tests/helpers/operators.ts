/**
 * SLICE-264-6 test helper — route-level tests authenticate with real
 * opk_ credentials now (the shared ADMIN_API_KEY no longer reaches
 * migrated surfaces outside the dual-auth window). Seeds a memory
 * operator + credential and hands back the plaintext key.
 */

import {
  adminKeyPrefix,
  createMemoryOperatorStore,
  generateAdminKeyPlaintext,
  hashAdminKey,
  type OperatorStore,
} from "../../src/server/lib/operators";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";

export interface SeededOperator {
  key: string;
  operatorId: string;
}

/** Seed an operator + credential; returns the opk_ plaintext. */
export async function seedOperator(
  store: OperatorStore,
  name = "Tester",
  capabilities = ["read", "workflow"],
): Promise<SeededOperator> {
  const op = await store.createOperator({
    id: `op_${generateReportId()}`,
    displayName: name,
    principalType: "human",
    capabilities,
  });
  if (!op.ok) throw new Error(`seed failed: ${op.reason}`);
  const key = generateAdminKeyPlaintext();
  const cred = await store.issueCredential({
    id: `opc_${generateReportId()}`,
    operatorId: op.operator.id,
    keyHash: hashAdminKey(key),
    keyPrefix: adminKeyPrefix(key),
  });
  if (!cred.ok) throw new Error(`seed failed: ${cred.reason}`);
  return { key, operatorId: op.operator.id };
}

export { createMemoryOperatorStore };
