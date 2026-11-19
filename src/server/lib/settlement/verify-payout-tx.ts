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
import { decimalToMicro } from "./invariants.js";
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
  /** Pinned token contract — when set, an ERC-20 from any other
   *  contract cannot satisfy the leg (M-6: a fake "USDC" symbol
   *  is not proof of payment). Absent → only the native rail counts. */
  token?: string;
  /** Treasury/ops wallet the payout must originate from (H5). */
  expectedPayer?: string;
  /** tx must be included at/after this time (ms epoch). */
  notBeforeMs?: number;
}

export interface PayoutTxCheck {
  /** true only when every mandatory check passed. */
  verified: boolean;
  reason?: string;
  /** Network label (e.g. "arc") — matched against the leg replay scope. */
  network?: string;
  /** Numeric chain id — matched against expected.chainId, NOT network. */
  chainId?: string;
  /** Sender — cross-checked when returned (≠ payee self-pay). */
  payer?: string;
  /** Asset the verifier observed moving. */
  asset?: string;
  /** Amount the verifier observed (decimal string). */
  amount?: string;
  /** Payee the verifier observed. */
  payee?: string;
  /** Token contract the verifier observed moving, or "native". */
  token?: string;
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
  // H5: `verified:true` with missing facts is NOT verifiable — the
  // mandatory fields must be present and must agree. An adapter that
  // attests without reporting cannot launder a blind `true`.
  const missing: string[] = [];
  if (check.asset === undefined) missing.push("asset");
  if (check.payee === undefined) missing.push("payee");
  if (check.amount === undefined) missing.push("amount");
  if (check.network === undefined) missing.push("network");
  // M-A: when the treasury payer is pinned, an adapter that omits
  // `payer` cannot prove the treasury paid — attest-without-report
  // would bypass the pin and the self-pay guard entirely.
  if (
    expected.expectedPayer !== undefined &&
    check.payer === undefined
  ) {
    missing.push("payer");
  }
  if (
    expected.chainId !== undefined &&
    check.chainId === undefined
  ) {
    missing.push("chainId");
  }
  if (
    typeof check.confirmations !== "number" ||
    check.confirmations < 1
  ) {
    missing.push("confirmations>=1");
  }
  if (missing.length) {
    return fail(
      "TX_UNVERIFIED",
      `verifier attested without reporting ${missing.join(", ")} — failing closed`,
    );
  }
  // Fact cross-checks — a verified tx whose reported fields contradict
  // the leg expectation is treated as unverified (H4 precedent).
  if (
    check.asset !== undefined &&
    check.asset.toUpperCase() !== expected.currency.toUpperCase()
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
  // Amounts compare numerically, not lexically — "10.0" === "10.00"
  // (M12: a string compare falsely rejects a real payment).
  // M-A: a malformed adapter amount must fail closed (TX_UNVERIFIED),
  // not escape decimalToMicro's throw as a 500.
  if (check.amount !== undefined) {
    let micro: bigint | null = null;
    let expectedMicro: bigint | null = null;
    try {
      micro = decimalToMicro(check.amount);
      expectedMicro = decimalToMicro(expected.amount);
    } catch {
      // M-A: a malformed amount on either side fails closed — never
      // a thrown 500 out of the compare.
      micro = null;
    }
    if (micro === null || micro !== expectedMicro) {
      return fail(
        "TX_UNVERIFIED",
        `verifier reports amount ${check.amount}, expected ${expected.amount}`,
      );
    }
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
  // H5: a third-party transfer to the payee is not the ops payout —
  // when the treasury payer is pinned, it must match.
  if (
    expected.expectedPayer !== undefined &&
    check.payer !== undefined &&
    check.payer.toLowerCase() !== expected.expectedPayer.toLowerCase()
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports payer ${check.payer}, expected treasury ${expected.expectedPayer}`,
    );
  }
  // M-6/R4-M2: the rails differ. "native" is Arc's gas token (USDC) —
  // always a valid leg rail, pinned or not. An ERC-20 token fact is
  // only meaningful against a configured pin: no pin → unverifiable
  // (fail closed, not ignored); pin → must match exactly.
  if (check.token !== undefined && check.token !== "native") {
    if (expected.token === undefined) {
      return fail(
        "TX_UNVERIFIED",
        `verifier reports token ${check.token} but no token pin is configured — cannot validate`,
      );
    }
    if (check.token.toLowerCase() !== expected.token.toLowerCase()) {
      return fail(
        "TX_UNVERIFIED",
        `verifier reports token ${check.token}, expected ${expected.token}`,
      );
    }
  }
  // R2-H2: chain id and network label are DISTINCT fields — comparing
  // check.network to both can never hold, and would DoS every mark-paid.
  // M-6: normalize before comparing — an adapter may report a number
  // or a hex ("0x...") chain id; strict equality on raw strings turns
  // that into a fail-closed DoS.
  const normChainId = (v: unknown): string | null => {
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) {
      return String(v);
    }
    if (typeof v !== "string") return null;
    const t = v.trim().toLowerCase();
    if (/^0x[0-9a-f]+$/.test(t)) return String(BigInt(t));
    if (/^[0-9]+$/.test(t)) return String(BigInt(t));
    return null;
  };
  if (
    expected.chainId !== undefined &&
    check.chainId !== undefined &&
    normChainId(check.chainId) !== normChainId(expected.chainId)
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports chain ${check.chainId}, expected ${expected.chainId}`,
    );
  }
  if (
    check.network !== undefined &&
    expected.network !== undefined &&
    check.network.trim().toLowerCase() !==
      expected.network.trim().toLowerCase()
  ) {
    return fail(
      "TX_UNVERIFIED",
      `verifier reports network ${check.network}, expected ${expected.network}`,
    );
  }
  return ok(check);
}
