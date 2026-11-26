/**
 * SLICE-255-2: MMF→prod adapter — scalar projection only (D-255-Q16).
 *
 * Numbers map 1:1 (MMF minor-unit integers ↔ our USD decimals, both
 * treated as opaque scalars). What has no prod equivalent is reported
 * via `unmapped`/`dimensions` — never emulated.
 *
 * Field map (equivalence):
 *   max_amount        → perTxUsd                (Exact)
 *   total_budget+W=1  → dailyUsd                (Exact window)
 *   total_budget+W=7  → weeklyUsd               (Exact window)
 *   total_budget+W=30 → monthlyUsd              (Exact window)
 *   velocity_limit    → maxTxPerHour            (Partial — MMF window is
 *                      trailing 86400s of issued auths incl. voided;
 *                      ours is rolling 3600s of reserved+settled)
 *   mandate.revoked   → wallet.suspended        (Partial — wallet-level
 *                      kill-switch ≈ mandate revocation)
 *   registry.revoked  → wallet.suspended        (Partial)
 *   registry.unavailable → walletStore.get throws (fail-closed probe)
 *   allowed_payees / currency / expires_in_days / payee → None
 *   tx.at (seconds)   → vi.setSystemTime(at*1000) (Exact)
 *   prior_txns        → settled ledger seeds    (Exact)
 *   tx.tx_id          → refId (correlation only — NOT a dedup key)
 */
import type { SpendCaps } from "../../../../src/server/lib/agent-wallet/registry";
import type { MmfBounds, MmfTx } from "./mmf-types";

/** budget_window_days → SpendCaps rolling-window field (exact only). */
export const CAPS_TO_WINDOW = {
  1: "dailyUsd",
  7: "weeklyUsd",
  30: "monthlyUsd",
} as const;

const MAPPED_BOUNDS = new Set([
  "max_amount",
  "total_budget",
  "budget_window_days",
  "velocity_limit",
]);

export function boundsToCaps(bounds: MmfBounds): {
  caps: SpendCaps;
  unmapped: string[];
} {
  const caps: SpendCaps = {};
  const unmapped: string[] = [];
  if (bounds.max_amount !== undefined) caps.perTxUsd = bounds.max_amount;
  if (bounds.total_budget !== undefined) {
    const w =
      CAPS_TO_WINDOW[
        bounds.budget_window_days as keyof typeof CAPS_TO_WINDOW
      ];
    if (w) caps[w] = bounds.total_budget;
    else if (bounds.budget_window_days !== undefined)
      unmapped.push(`budget_window_days:${bounds.budget_window_days}`);
  }
  if (bounds.velocity_limit !== undefined && bounds.velocity_limit > 0) {
    caps.maxTxPerHour = bounds.velocity_limit;
  }
  for (const k of Object.keys(bounds)) {
    if (!MAPPED_BOUNDS.has(k)) unmapped.push(k);
  }
  return { caps, unmapped };
}

/**
 * Scalar projection of the tx amount for our `amountUsd: number` API.
 * `amount` passes verbatim (incl. non-number JSON values like "10" —
 * we keep what the wire carried). `amount_json` is the raw lexical
 * token: our API cannot see lexical form, so the parsed scalar goes
 * through and the dimension is recorded as None (D-255-Q16).
 */
export function mmfAmountToScalar(tx: MmfTx): unknown {
  if (tx.amount !== undefined) return tx.amount;
  if (tx.amount_json !== undefined) return Number(tx.amount_json);
  return undefined;
}

/** tx.at is epoch SECONDS (fractional allowed, e.g. 1000.5). */
export function mmfAtToMs(at: number | undefined): number | undefined {
  return at === undefined ? undefined : Math.round(at * 1000);
}

/**
 * Our deny-reason → MMF §5 check-id. null = no MMF analogue (the
 * branch is ours alone: kind-gate, approval-hold, registration).
 * registry-unavailable → REVOKED_REGISTRY only via GATE_EXCEPTION
 * (prod throws before producing a deny).
 */
export function checkIdForDeny(deny: string): string | null {
  switch (deny) {
    case "perTx":
      return "CAP_EXCEEDED";
    case "daily":
    case "weekly":
    case "monthly":
      return "BUDGET";
    case "velocity_tx":
    case "velocity_amount":
      return "VELOCITY";
    // wallet-suspend is the closest mechanism to mandate revocation.
    case "spend_suspended":
      return "REVOKED";
    // 263-1: enforcer.begin validity-gate — NaN/±∞/≤0/non-numeric
    // scalars deny BEFORE caps (draft §4 NON_POSITIVE ordering).
    case "invalid_amount":
      return "NON_POSITIVE";
    // delegate-path reasons (spendAsDelegate).
    case "no-active-delegate":
    case "delegate-suspended":
      return "REVOKED";
    case "cap-exceeded":
      return "CAP_EXCEEDED";
    default:
      return null;
  }
}
