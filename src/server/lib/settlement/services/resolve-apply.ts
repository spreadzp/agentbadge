/**
 * EPIC-227 / SLICE-227-8 — the resolve atomic's per-milestone apply
 * block, extracted from dispute-resolve.ts under the 300-line cap.
 *
 * Operates ONLY on what the dispute froze (H3): a second OPEN
 * dispute's freeze must survive this resolve untouched. Events go to
 * the caller's buffer — emitted post-commit (M-2).
 */
import type {
  DisputeRow,
  SettlementStores,
} from "@agentbadge/database";

import type { SettlementEmitBuffer } from "../events.js";
import {
  type ResolveDisputeInput,
  SettlementConflictError,
} from "../types.js";
import { newLegId } from "./ctx.js";
import type { FreezeMap, SubjectScope } from "./dispute-scope.js";

export async function applyFreezeResolution(
  s: SettlementStores,
  dispute: DisputeRow,
  scope: SubjectScope,
  freeze: FreezeMap | undefined,
  input: ResolveDisputeInput,
  buf: SettlementEmitBuffer,
  operator: string,
): Promise<void> {
  // H3: operate ONLY on what THIS dispute froze — never on live
  // status (a second OPEN dispute's freeze must survive resolve).
  const frozenIntentIds = new Set(freeze?.intentIds ?? []);
  const frozenLegIds = new Set(freeze?.legIds ?? []);
  for (const scoped of scope.milestones) {
    const m = (await s.milestones.getById(scoped.id)) ?? scoped;
    const prev = freeze?.milestones[m.id];
    const intent = (
      await Promise.all(
        [...frozenIntentIds].map((id) => s.payoutIntents.getById(id)),
      )
    ).find((i) => i?.milestoneRef === m.id);
    let intentEvent: "intent.cancelled" | "intent.unfrozen" | null = null;
    if (input.resolution === "FOR_BUYER") {
      if (m.status === "DISPUTED" && prev !== undefined) {
        await s.milestones.applyStatus(m.id, "DISPUTED", "CANCELLED");
      }
      if (intent && intent.status === "FROZEN") {
        const cancelled = await s.payoutIntents.applyStatus(
          intent.id,
          "FROZEN",
          "CANCELLED",
        );
        if (cancelled) intentEvent = "intent.cancelled";
        for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
          if (leg.status === "FROZEN" && frozenLegIds.has(leg.id)) {
            await s.payoutLegs.applyStatus(leg.id, "FROZEN", "CANCELLED");
          }
        }
      }
    } else {
      // FOR_PROVIDER | SPLIT — restore the frozen work to payable.
      if (m.status === "DISPUTED" && prev !== undefined) {
        const to = input.resolution === "SPLIT" ? "APPROVED" : prev;
        // R6-M2: a restored APPROVED belongs to the RESOLVER's cycle —
        // re-stamp the approval token so a stale gate revert (whose
        // token was minted by the pre-dispute approve) is refused.
        await s.milestones.applyStatus(m.id, "DISPUTED", to, to === "APPROVED"
          ? { escrowRef: `appr_${crypto.randomUUID()}` }
          : undefined);
      }
      if (intent && intent.status === "FROZEN") {
        if (input.resolution === "SPLIT") {
          // Re-leg: cancel the frozen legs, create the split set.
          for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
            if (leg.status === "FROZEN" && frozenLegIds.has(leg.id)) {
              await s.payoutLegs.applyStatus(leg.id, "FROZEN", "CANCELLED");
            }
          }
          for (const leg of input.splitLegs ?? []) {
            const row = await s.payoutLegs.create({
              id: newLegId(),
              intentId: intent.id,
              payee: leg.payee,
              amountUsdc: leg.amountUsdc,
              role: leg.role,
              status: "OPEN",
              network: "arc",
              payload: { splitOf: dispute.id },
            });
            if (!row) {
              throw new SettlementConflictError(
                "split leg insert conflict — aborting resolve",
              );
            }
          }
        } else {
          // FOR_PROVIDER — the freeze lifts: legs return to payable.
          for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
            if (leg.status === "FROZEN" && frozenLegIds.has(leg.id)) {
              await s.payoutLegs.applyStatus(leg.id, "FROZEN", "OPEN");
            }
          }
        }
        const reopened = await s.payoutIntents.applyStatus(
          intent.id,
          "FROZEN",
          "OPEN",
        );
        if (reopened) intentEvent = "intent.unfrozen";
      }
    }
    // Nit: emit ONLY for a row this resolve actually moved — a
    // frozen-id intent found in another status is not our event.
    if (intentEvent && intent) {
      buf.emit({
        entityType: "payout_intent",
        entityId: intent.id,
        eventType: intentEvent,
        actorWallet: operator,
        payload: { disputeId: dispute.id, resolution: input.resolution },
      });
    }
  }
}
