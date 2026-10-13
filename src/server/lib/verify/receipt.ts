/**
 * SLICE-180-4: inline verify receipt — the CiteFlow receipts pattern:
 * a paid response carries its own verification pointers so the caller
 * re-checks without a second lookup round-trip. memoId is deterministic
 * (verdictMemoId) — available before the fire-and-forget anchor send.
 */
import type { Hex } from "viem";
import { verdictMemoId } from "../eaas/anchor";

export function verifyReceipt(verdictId: Hex): {
  verifyUrl: string;
  verify: { api: string; page: string; memoId: Hex };
} {
  return {
    verifyUrl: `/api/eaas/verdicts/${verdictId}/verify`,
    verify: {
      api: `/api/verify/${verdictId}`,
      page: `/verify/${verdictId}`,
      memoId: verdictMemoId(verdictId),
    },
  };
}
