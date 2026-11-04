/**
 * SLICE-206-3: public read projection for market tasks (D-206-6).
 *
 * Public shape ≠ internal store (landmine): no posterDid/claimerDid
 * (owner metadata), no internal fields (transitionalSince, lastError,
 * verificationAttempts). budget_status is DERIVED — never set by hand:
 *   - budget === 0 → DECLARED_NOT_RESERVED (reputation-only, no escrow)
 *   - escrowStatus "pending"  → ESCROWED (EaaS-side reserved it)
 *   - escrowStatus "released" → PAID (settled)
 *   - otherwise → DECLARED_NOT_RESERVED (honest cap: declared ≠ reserved)
 *
 * Transitions land via setEscrowStatus() from the EaaS/settle side —
 * this module only reads the already-persisted store field, which is
 * the in-memory transition record (v1; Postgres repo is a later seam).
 */
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import {
  buildMachineEntry,
  type BudgetStatus,
  type MachineEntry,
} from "../machine-entry";

const TASK_CURRENCY = "HBAR";

export function deriveBudgetStatus(t: CachedMarketTask): BudgetStatus {
  if (t.priceHbar === 0) return "DECLARED_NOT_RESERVED";
  if (t.escrowStatus === "released") return "PAID";
  if (t.escrowStatus === "pending") return "ESCROWED";
  return "DECLARED_NOT_RESERVED";
}

/** List-row projection for GET /api/tasks/open. */
export function publicTaskSummary(t: CachedMarketTask) {
  return {
    task_id: t.taskId,
    title: t.title,
    budget: t.priceHbar,
    currency: TASK_CURRENCY,
    budget_status: deriveBudgetStatus(t),
    deadline: t.deadline != null ? new Date(t.deadline).toISOString() : null,
    required_capabilities: t.capabilities ?? [],
    status: t.status,
  };
}

export type PublicTaskSummary = ReturnType<typeof publicTaskSummary>;

/** Detail projection for GET /api/tasks/:id — adds spec + machine_entry. */
export function publicTaskDetail(t: CachedMarketTask) {
  const budgetStatus = deriveBudgetStatus(t);
  const machineEntry: MachineEntry = buildMachineEntry({
    id: t.taskId,
    budget: t.priceHbar,
    currency: TASK_CURRENCY,
    budgetStatus,
    deadline: t.deadline ?? null,
    requiredCapabilities: t.capabilities ?? [],
  });
  return {
    ...publicTaskSummary(t),
    description: t.description,
    created_at: new Date(t.createdAt).toISOString(),
    machine_entry: machineEntry,
  };
}

/** Status projection for GET /api/tasks/:id/status (verify-status phase). */
export function publicTaskStatus(t: CachedMarketTask) {
  return {
    task_id: t.taskId,
    status: t.status,
    budget_status: deriveBudgetStatus(t),
    updated_at: new Date(t.createdAt).toISOString(),
  };
}

/** Entry-point payload — shared by GET /api/start-here and the public
 *  MCP `start_here` tool (single source, 206-4). */
export function startHerePayload(openCount: number) {
  return {
    protocol_doc: "/.well-known/agentbadge-machine.json",
    protocol_version: "agentbadge-market/1",
    open_tasks: openCount,
    next_call: { method: "GET", path: "/api/tasks/open" },
    auth_required_for_writes: "sig-auth (X-Wallet/X-Sig/X-Timestamp)",
  };
}
