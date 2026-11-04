/**
 * SLICE-206-1: machine descriptor + per-task `machine_entry` schema.
 *
 * Two artifacts, one module (single source of truth):
 *  - buildMachineDescriptor() — global `/.well-known/agentbadge-machine.json`
 *    canonical protocol doc: auth, ordered endpoints, contract limits,
 *    verification rule, budget_status enum (D-206-2).
 *  - machineEntrySchema / buildMachineEntry() — typed per-task block that
 *    tells an agent exactly which calls this task needs (D-206-2: global
 *    doc + per-task конкретика, no ~200-line spec duplication per task).
 *
 * CONTRACT_LIMITS is the shared const imported by 206-2 zod guards —
 * limits live here, nowhere else (landmine: no hardcoded dup).
 */
import { z } from "zod";

// ─── Contract limits (shared const — 206-2 imports these) ────────

export const CONTRACT_LIMITS = {
  idempotencyKey: { min: 8, max: 128 },
  evidenceRefs: { maxCount: 50, maxLen: 1000 },
  summary: { maxLen: 4000 },
} as const;

export const PROTOCOL_VERSION = "agentbadge-market/1";

/** D-206-6: honest cap — declared budget ≠ reserved funds. */
export const BUDGET_STATUSES = [
  "DECLARED_NOT_RESERVED",
  "ESCROWED",
  "PAID",
] as const;
export const budgetStatusSchema = z.enum(BUDGET_STATUSES);
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;

// ─── Canonical endpoint template ─────────────────────────────────

const endpointSchema = z.object({
  phase: z.enum(["discover", "read", "start", "bid", "deliver", "verify-status"]),
  method: z.enum(["GET", "POST"]),
  path: z.string(),
  /** Public-MCP tool equivalent (206-4 read tools); null when write-only. */
  tool_equiv: z.string().nullable(),
  auth: z.enum(["none", "sig-auth"]),
});
export type EndpointDef = z.infer<typeof endpointSchema>;

/**
 * Ordered agent path: discover → read → start → bid → deliver → status.
 * `{task_id}` is a placeholder — buildMachineEntry substitutes the real id.
 * Paths are the 206-3/206-6 canonical routes the epic builds toward.
 */
export const ENDPOINT_TEMPLATE: readonly EndpointDef[] = [
  { phase: "discover", method: "GET", path: "/api/tasks/open", tool_equiv: "open_tasks", auth: "none" },
  { phase: "read", method: "GET", path: "/api/tasks/{task_id}", tool_equiv: "get_task", auth: "none" },
  { phase: "start", method: "GET", path: "/api/start-here", tool_equiv: "start_here", auth: "none" },
  { phase: "bid", method: "POST", path: "/api/tasks/{task_id}/bids", tool_equiv: null, auth: "sig-auth" },
  { phase: "deliver", method: "POST", path: "/api/tasks/{task_id}/deliverables", tool_equiv: null, auth: "sig-auth" },
  { phase: "verify-status", method: "GET", path: "/api/tasks/{task_id}/status", tool_equiv: "get_task", auth: "none" },
] as const;

// ─── Global descriptor (well-known doc) ──────────────────────────

const SIG_CHALLENGE_FORMAT =
  "agentbadge-access:v1\\nwallet:<lowercased>\\nmethod:<UPPER>\\npath:<path>\\ntimestamp:<unix_seconds>";

export function buildMachineDescriptor() {
  return {
    protocol_version: PROTOCOL_VERSION,
    auth: {
      scheme: "sig-auth",
      signature: "EIP-191 personal_sign over challenge",
      challenge_format: SIG_CHALLENGE_FORMAT,
      headers: { wallet: "X-Wallet", signature: "X-Sig", timestamp: "X-Timestamp" },
      timestamp_skew_seconds: 300,
      /** EIP-191 is chain-agnostic; wallets live on these networks. */
      chains: ["eip155:5042002", "eip155:5042001", "eip155:84532"],
    },
    endpoints: [...ENDPOINT_TEMPLATE],
    contract: {
      idempotency_key: {
        header: "idempotency-key",
        min: CONTRACT_LIMITS.idempotencyKey.min,
        max: CONTRACT_LIMITS.idempotencyKey.max,
        required_on: ["bid", "deliver", "verdict"],
        duplicate_response: "identical body + duplicate:true, zero side-effects",
      },
      evidence_refs: {
        max_count: CONTRACT_LIMITS.evidenceRefs.maxCount,
        max_len: CONTRACT_LIMITS.evidenceRefs.maxLen,
      },
      summary: { max_len: CONTRACT_LIMITS.summary.maxLen },
    },
    /** D-206-4: verifier must be independent of both parties + platform. */
    verification: {
      rule: "verifier_wallet != owner != worker != platform_signer",
      errors: ["VERIFIER_IS_OWNER", "VERIFIER_IS_WORKER", "VERIFIER_IS_PLATFORM"],
      verdicts: ["PASS", "REVISE", "FAIL"],
    },
    budget_status: [...BUDGET_STATUSES],
  } as const;
}

// ─── Per-task machine_entry block ────────────────────────────────

const callSchema = z.object({
  phase: endpointSchema.shape.phase,
  method: endpointSchema.shape.method,
  path: z.string(),
  tool_equiv: z.string().nullable(),
  auth: endpointSchema.shape.auth,
  /** Arguments the caller must send (names, not values — shape hints). */
  args: z.array(z.string()).default([]),
});
export type MachineEntryCall = z.infer<typeof callSchema>;

export const machineEntrySchema = z.object({
  task_id: z.string().min(1),
  budget_usdc: z.number().nonnegative(),
  budget_status: budgetStatusSchema,
  /** ISO-8601 deadline; null when the task has none. */
  deadline: z.string().nullable(),
  required_capabilities: z.array(z.string()).default([]),
  calls: z.array(callSchema).min(1),
  evidence: z.object({
    refs_max_count: z.number().int(),
    ref_max_len: z.number().int(),
    summary_max_len: z.number().int(),
  }),
});
export type MachineEntry = z.infer<typeof machineEntrySchema>;

/** Per-call argument hints — keeps schemas in one place for 206-5/206-6. */
const PHASE_ARGS: Partial<Record<EndpointDef["phase"], string[]>> = {
  bid: ["idempotency_key", "proposal", "price_usdc"],
  deliver: ["idempotency_key", "evidence_refs", "summary"],
};

export interface MachineEntryTask {
  id: string;
  budgetUsdc: number;
  budgetStatus?: BudgetStatus;
  /** ISO string or epoch ms. */
  deadline?: string | number | null;
  requiredCapabilities?: string[];
}

/** Build the typed per-task block: endpoint template with real task_id. */
export function buildMachineEntry(task: MachineEntryTask): MachineEntry {
  const calls: MachineEntryCall[] = ENDPOINT_TEMPLATE.filter(
    (e) => e.phase !== "discover" && e.phase !== "start",
  ).map((e) => ({
    phase: e.phase,
    method: e.method,
    path: e.path.replace("{task_id}", task.id),
    tool_equiv: e.tool_equiv,
    auth: e.auth,
    args: PHASE_ARGS[e.phase] ?? [],
  }));
  const deadline =
    task.deadline == null
      ? null
      : typeof task.deadline === "number"
        ? new Date(task.deadline).toISOString()
        : task.deadline;
  return machineEntrySchema.parse({
    task_id: task.id,
    budget_usdc: task.budgetUsdc,
    budget_status: task.budgetStatus ?? "DECLARED_NOT_RESERVED",
    deadline,
    required_capabilities: task.requiredCapabilities ?? [],
    calls,
    evidence: {
      refs_max_count: CONTRACT_LIMITS.evidenceRefs.maxCount,
      ref_max_len: CONTRACT_LIMITS.evidenceRefs.maxLen,
      summary_max_len: CONTRACT_LIMITS.summary.maxLen,
    },
  });
}
