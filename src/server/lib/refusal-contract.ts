/**
 * SLICE-181-1: Honest-refusal contract — single source of truth.
 *
 * "Refusal ≠ charged": when the server refuses to execute (policy refusal,
 * insufficient subject, failed execution), the caller is never charged.
 * The matrix below feeds the error catalog entries, the public
 * `refusal-contract.json` manifest, and the `refuse()` response helper.
 *
 * Manifest is served at GET /api/meta/refusal-contract (fallback until
 * EPIC-178 manifest-registry is ready, which will also expose
 * /.well-known/refusal-contract.json).
 */

import { z } from "zod";
import type { ErrorEntry, RecoveryAction } from "./error-catalog";

export interface RefusalMatrixEntry {
  /** Stable refusal code (snake_case, matches ErrorCodes wire values). */
  code: string;
  /** HTTP status returned with the refusal. */
  http: number;
  /** Charge semantics — "never" means the request is never billed. */
  charge: "never" | "conditional";
  /** "auto" = automatic refund tx attempted when payment already settled on-chain. */
  refund?: "auto";
  /** Why this refusal exists (manifest-facing explanation). */
  reason: string;
  /** Catalog agent_impact text. */
  agentImpact: string;
  /** Catalog hint_template text. */
  hint: string;
  /** Catalog affected_routes. */
  routes: string[];
  /** Catalog recovery_action (must NOT be payment-oriented). */
  recovery: RecoveryAction;
}

export const REFUSAL_MATRIX: RefusalMatrixEntry[] = [
  {
    code: "policy_refusal",
    http: 409,
    charge: "never",
    reason:
      "The server refuses to execute the job under its evaluation/fulfillment policy (e.g. job not in a valid state, policy pack unsatisfiable).",
    agentImpact:
      "The request was refused by policy before any work was done. No charge was applied.",
    hint:
      "Check the referenced job/resource state and the error hint. Create a new resource or choose an alternative service instead of retrying unchanged.",
    routes: ["/api/eaas/jobs/evaluate", "/api/keeperhub/*"],
    recovery: "choose_alternative",
  },
  {
    code: "insufficient_subject",
    http: 422,
    charge: "never",
    reason:
      "The submitted subject lacks the data required to produce a meaningful result (e.g. no history, unreachable target, empty evidence).",
    agentImpact:
      "The subject could not be evaluated — insufficient data. No charge was applied.",
    hint:
      "Enrich the subject or change the request (see hint details). Retry only after the underlying data problem is fixed.",
    routes: ["*"],
    recovery: "change_request",
  },
  {
    code: "execution_failed",
    http: 502,
    charge: "never",
    refund: "auto",
    reason:
      "Execution failed due to a server-side or upstream error after payment was verified. If a settlement already happened (self-settle rails), an automatic refund is attempted.",
    agentImpact:
      "The service failed to produce a result due to a platform/upstream error. No charge was applied; any settled amount is refunded automatically.",
    hint:
      "Retry the request after a short delay. If persistent, escalate via GET /contact — include the refund record id if present.",
    routes: ["*"],
    recovery: "retry_immediately",
  },
  {
    code: "data_unavailable",
    http: 503,
    charge: "never",
    reason:
      "The requested live-data feed is stale beyond its freshness window or fully unavailable. The request is refused instead of serving outdated data as fresh.",
    agentImpact:
      "The live-data feed could not serve honest data right now. The response was refused before settlement — no charge was applied.",
    hint:
      "Retry after a short delay — feeds refresh continuously. Free-tier responses may carry data_status:'stale' + stale_since instead of refusing.",
    routes: ["/mcp/bstock", "/api/bstock/*"],
    recovery: "retry_immediately",
  },
];

/** Refusal codes as a set — used by error-response refuse() for status lookup. */
export const REFUSAL_CODES = new Map(REFUSAL_MATRIX.map((m) => [m.code, m]));

export type RefusalCode = (typeof REFUSAL_MATRIX)[number]["code"];

// ─── Catalog entries (single source — no dual copies) ────────────────

/** Derive ErrorEntry[] from the refusal matrix — keeps catalog and manifest in sync. */
export function refusalErrorEntries(): ErrorEntry[] {
  return REFUSAL_MATRIX.map((m) => ({
    code: m.code,
    http_status: m.http,
    agent_impact: m.agentImpact,
    hint_template: m.hint,
    affected_routes: m.routes,
    recovery_action: m.recovery,
    charge: m.charge,
  }));
}

// ─── Public manifest ──────────────────────────────────────────────────

export const refusalContractSchema = z.object({
  version: z.literal("1.0"),
  policy: z.literal("no-charge-on-refusal"),
  refusals: z.array(
    z.object({
      code: z.string(),
      http: z.number().int(),
      charge: z.enum(["never", "conditional"]),
      refund: z.enum(["auto"]).optional(),
      reason: z.string(),
    }),
  ),
  degraded: z.object({
    field: z.literal("degraded"),
    marker: z.literal("data_status"),
    statuses: z.tuple([
      z.literal("fresh"),
      z.literal("stale"),
      z.literal("unavailable"),
    ]),
    stale_since: z.literal("ISO-8601"),
    charge_policy: z.string(),
  }),
  price_truth: z.string(),
  disclosure: z.string(),
});

export type RefusalContract = z.infer<typeof refusalContractSchema>;

export function getRefusalContract(): RefusalContract {
  return {
    version: "1.0",
    policy: "no-charge-on-refusal",
    refusals: REFUSAL_MATRIX.map((m) => ({
      code: m.code,
      http: m.http,
      charge: m.charge,
      ...(m.refund ? { refund: m.refund } : {}),
      reason: m.reason,
    })),
    degraded: {
      field: "degraded",
      marker: "data_status",
      statuses: ["fresh", "stale", "unavailable"],
      stale_since: "ISO-8601",
      charge_policy:
        "paid requests on unavailable data are refused (charge: never); only free-tier responses may carry degraded markers",
    },
    price_truth:
      "402 accept.amount is canonical; clients verify vs /api/v1/services",
    disclosure: "unilateral decisions carry a disclosure field",
  };
}
