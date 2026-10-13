/**
 * Verdict verification error entries (EPIC-180) — extracted from
 * error-catalog.ts (max-lines split).
 */
import type { ErrorEntry } from "./error-catalog";

export const VERIFY_ERROR_ENTRIES: ErrorEntry[] = [
  {
    code: "verdict_not_found",
    http_status: 404,
    agent_impact:
      "No stored verdict matches the given verdictId. Nothing was " +
      "charged; the id is simply unknown to this deployment.",
    hint_template:
      "Check the verdictId format (0x + 64 hex). List a consumer's " +
      "verdicts via GET /api/eaas/feed?wallet=<0x…>.",
    affected_routes: ["/api/verify/:verdictId"],
    recovery_action: "change_request",
    charge: "never",
  },

  // ─── EPIC-180-4: proof-kind registry ───
  {
    code: "unknown_proof_kind",
    http_status: 400,
    agent_impact:
      "The requested proof kind is not in PROOF_KINDS_V1. Known: " +
      "verdict, witness, anchor-head.",
    hint_template:
      "Use one of the registered kinds (see proof_kinds in the " +
      "verify response) or omit ?kind= for the full report.",
    affected_routes: ["/api/verify/:verdictId"],
    recovery_action: "change_request",
    charge: "never",
  },
  {
    code: "rpc_unavailable",
    http_status: 503,
    agent_impact:
      "The verifier's upstream RPC is unreachable — an honest " +
      "error, NOT a verdict. Retry; do not treat as invalid.",
    hint_template:
      "Retry later or point VERIFY_RPC_URL/--rpc at a healthy " +
      "endpoint. The standalone package throws VerifyError(rpc_unavailable).",
    affected_routes: [],
    recovery_action: "wait_and_retry",
    charge: "never",
  },
];
