/**
 * SLICE-225-6 (EPIC-225): reversal-scoped entitlement transitions —
 * extracted from entitlements.ts to keep it under the max-lines
 * lint bound. `revokeForReversal` stamps a payload marker so
 * `reactivate` can undo the revoke when the source payment flips
 * back to CONFIRMED (audit v2 N-6); admin revokes carry no marker
 * and stay permanent.
 */
import type { EntitlementRow, EntitlementStore } from "@agentbadge/database";

import { assertNonEmpty } from "./guards";
import { conflict, notFound } from "./types";

export interface EntitlementReversal {
  /** ACTIVE → REVOKED by the reversal pass — stamps
   *  `payload.reversedBy = "payment-reversal"` so `reactivate()`
   *  can undo it when the payment flips back to CONFIRMED
   *  (audit v2 N-6). */
  revokeForReversal(id: string): Promise<EntitlementRow>;
  /** REVOKED → ACTIVE — ONLY for rows the reversal pass revoked
   *  (`payload.reversedBy === "payment-reversal"`). Used by the
   *  sweeper when the source payment is CONFIRMED again (audit
   *  v2 N-6). Admin revocations (no marker) cannot reactivate. */
  reactivate(id: string): Promise<EntitlementRow>;
}

export function createEntitlementReversal(
  entitlements: EntitlementStore,
  now: () => number,
): EntitlementReversal {
  async function revokeForReversal(id: string): Promise<EntitlementRow> {
    const idNorm = assertNonEmpty(id, "id");
    const existing = await entitlements.getById(idNorm);
    if (!existing) throw notFound("entitlement", idNorm);
    const row = await entitlements.applyStatus(
      idNorm,
      "ACTIVE",
      "REVOKED",
      { reversedBy: "payment-reversal" },
    );
    if (!row) {
      throw conflict(
        `entitlement ${idNorm} is ${existing.status} — only ACTIVE → REVOKED`,
        { id: idNorm, status: existing.status },
      );
    }
    return row;
  }

  async function reactivate(id: string): Promise<EntitlementRow> {
    const idNorm = assertNonEmpty(id, "id");
    const existing = await entitlements.getById(idNorm);
    if (!existing) throw notFound("entitlement", idNorm);
    const marker =
      existing.payload && typeof existing.payload === "object"
        ? (existing.payload as Record<string, unknown>).reversedBy
        : undefined;
    if (marker !== "payment-reversal") {
      throw conflict(
        "reactivate is only for payment-reversal revocations",
        { id: idNorm },
      );
    }
    const row = await entitlements.applyStatus(
      idNorm,
      "REVOKED",
      "ACTIVE",
      { reversedBy: undefined, reactivatedAtMs: now() },
    );
    if (!row) {
      throw conflict(
        `entitlement ${idNorm} is ${existing.status} — only REVOKED → ACTIVE`,
        { id: idNorm, status: existing.status },
      );
    }
    return row;
  }

  return { revokeForReversal, reactivate };
}
