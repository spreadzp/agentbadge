/**
 * EPIC-227 / SLICE-227-2 — `VerifyPayoutTx` seam contract, after the
 * VerifyRefundTx precedent (D-226-4 / review-1911 §3.4).
 *
 * The adapter answers whether a REAL transaction satisfies a leg's
 * expectation. When an adapter is wired, a mark-paid MUST pass it —
 * and every non-`verified` outcome (false, empty, malformed, timeout,
 * throw) fails closed with a typed error: never a blind-trust 200.
 *
 * Mandatory adapter checks when wired (contract for implementers):
 * - chainId/network — the tx landed on the expected network;
 * - asset/token — the transferred asset is the leg's currency;
 * - exact amount — observed transfer equals amountUsdc;
 * - payee — the destination equals the leg's payee;
 * - finality — confirmations meet the adapter's threshold;
 * - replay — (network, txHash) uniqueness (also enforced in the store);
 * - tx age — inclusion at/after `notBeforeMs` (a payout predating the
 *   intent can never satisfy it).
 *
 * Without an adapter, mark-paid stays a manual-ops path: the operator
 * supplies the real txHash they sent (format-validated, replay-bound,
 * audited) — `requireVerification` flips that into a hard 503-style
 * failure instead of attestation.
 */

import { PROVIDER_TIMEOUT_MS, withTimeout } from "../finops/provider-utils.js";
import {
  type SettlementResult,
  fail,
  ok,
} from "./types.js";

export interface PayoutTxExpectation {
  /** Leg destination — observed recipient must equal this. */
  payee: string;
  /** Decimal string — observed transfer must equal amountUsdc. */
  amount: string;
  /** Asset/currency symbol (e.g. USDC). */
  currency: string;
  /** Expected network label — the leg's replay scope. */
  network?: string;
  /** Expected chain id when the adapter pins one. */
  chainId?: string;
  /** tx must be included at/after this time (ms epoch). */
  notBeforeMs?: number;
}

export interface PayoutTxCheck {
  /** true only when every mandatory check passed. */
  verified: boolean;
  reason?: string;
  network?: string;
  /** Sender — cross-checked when returned (≠ payee self-pay). */
  payer?: string;
  /** Asset the verifier observed moving. */
  asset?: string;
  /** Amount the verifier observed (decimal string). */
  amount?: string;
  /** Payee the verifier observed. */
  payee?: string;
  confirmations?: number;
}

export type VerifyPayoutTx = (
  txHash: string,
  expected: PayoutTxExpectation,
) => Promise<PayoutTxCheck>;

/**
 * Run the adapter with a bounded wait and cross-check its report —
 * an empty/malformed response is a typed failure, not blind trust
 * (review-1911 §3.4). Adapter-reported facts that contradict the
 * expectation (asset, payee, amount, payer==payee self-pay) also fail.
 */
export async function verifyLegTx(
  verifyTx: VerifyPayoutTx,
  txHash: string,
  expected: PayoutTxExpectation,
): Promise<SettlementResult<PayoutTxCheck>> {
  let check: PayoutTxCheck;
  try {
    const r = await withTimeout(
      verifyTx(txHash, expected),
      PROVIDER_TIMEOUT_MS,
    );
    if (!r || typeof r.verified !== "boolean") {
      return fail(
        "TX_UNVERIFIED",
        "verifier returned an empty/malformed response — failing closed",
      );
    }
    check = r;
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `payout verification failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!check.verified) {
    return fail(
      "TX_UNVERIFIED",
      check.reason ?? `tx ${txHash} not verified against leg expectation`,
    );
  }
  // Fact cross-checks — a verified tx whose reported fields contradict
  // the leg expectation is treated as unverified (H4 precedent).
  if (
    check.asset !== undefined &&
    check.asset !== expected.currency
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports asset ${check.asset}, expected ${expected.currency}`,
    );
  }
  if (
    check.payee !== undefined &&
    check.payee.toLowerCase() !== expected.payee.toLowerCase()
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports payee ${check.payee}, expected ${expected.payee}`,
    );
  }
  if (
    check.amount !== undefined &&
    check.amount !== expected.amount
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports amount ${check.amount}, expected ${expected.amount}`,
    );
  }
  if (
    check.payer !== undefined &&
    check.payer.toLowerCase() === expected.payee.toLowerCase()
  ) {
    return fail(
      "TX_UNVERIFIED",
      "verifier reports payer == payee — self-pay cannot satisfy a leg",
    );
  }
  if (
    check.network !== undefined &&
    expected.network !== undefined &&
    check.network !== expected.network
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports network ${check.network}, expected ${expected.network}`,
    );
  }
  return ok(check);
}
