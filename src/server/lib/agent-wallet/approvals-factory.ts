// SLICE-176-11: approval-store factory — split out of approvals.ts
// (300-line guard) once the "db" branch landed. Re-exported through
// approvals.ts so the import surface stays single.

import type { SpendApprovalRepository } from "@agentbadge/database";

import {
  createJsonApprovalStore,
  createMemoryApprovalStore,
  type ApprovalStore,
} from "./approvals";
import { createSqliteApprovalStore } from "./approvals-sqlite";
import { createDbApprovalStore } from "./approvals-db";

export type ApprovalStoreBackend =
  | "json"
  | "sqlite"
  | "memory"
  | "auto"
  | "db";

/**
 * Backend selection:
 *  - "db" → Postgres repo (176-11), fail-closed: throws when repo absent
 *  - "auto" → db when repo exists (createSpendLedger convention, 155-11),
 *    else bun:sqlite under Bun / json fallback under node/vitest
 *  - "sqlite" → bun:sqlite ?? json;  "memory" → ephemeral;  "json" → file
 */
export function createApprovalStore(
  backend: ApprovalStoreBackend = "auto",
  path?: string,
  maxPending = 20,
  repo?: SpendApprovalRepository | null,
): ApprovalStore {
  if (backend === "db") {
    if (!repo) {
      throw new Error(
        'AGENT_WALLET_APPROVAL_STORE=db requires DATABASE_ENABLED — spendApprovals repo is null',
      );
    }
    return createDbApprovalStore(repo, maxPending)!;
  }
  if (backend === "auto" && repo) return createDbApprovalStore(repo, maxPending)!;
  if (backend === "memory") return createMemoryApprovalStore(maxPending);
  if (backend === "sqlite" || backend === "auto") {
    return (
      createSqliteApprovalStore(path, maxPending) ??
      createJsonApprovalStore(
        (path ?? "").replace(/\.db$/, ".json") || undefined,
        maxPending,
      )
    );
  }
  return createJsonApprovalStore(path, maxPending);
}
