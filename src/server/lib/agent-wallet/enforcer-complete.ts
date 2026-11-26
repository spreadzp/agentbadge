// SLICE-263-1: enforcer.complete extracted from enforcer.ts
// (300-line guard). Post-execution settlement: reserved → settled /
// released transition + the clamp consistency-chain guard (D6) +
// the no-caps ledger-completeness insert.

import { newSpendId } from "./ledger";
import { emitSpendAlert } from "./audit";
import type {
  SpendEnforcer,
  SpendEnforcerDeps,
} from "./enforcer-types";

/** Factory for the `complete` side of SpendEnforcer — keeps the
 *  settlement path a single audit surface. */
export function createCompleter(
  deps: SpendEnforcerDeps,
): SpendEnforcer["complete"] {
  return async (begun, ok, amountUsd, kind, refId, txHash, sourceChain) => {
    if (begun.entry) {
      await deps.ledger.transition(
        begun.entry.id,
        ok ? "settled" : "released",
        txHash,
        sourceChain,
      );
      // EPIC-263-1 consistency-chain guard: effective → reserved →
      // downstream must agree. A clamped entry means reserved=
      // effective ≠ requested — if the caller reports a different
      // settled amount, the downstream paid the wrong sum: alert,
      // never stay silent (GPT boundary — clamp changes the
      // authorization, not the agent's intent).
      if (
        begun.entry.clamped === true &&
        amountUsd !== undefined &&
        amountUsd !== begun.entry.amountUsd
      ) {
        emitSpendAlert(
          "spend.clamp_mismatch",
          begun.wallet ?? begun.entry.wallet,
          {
            entryId: begun.entry.id,
            reservedUsd: begun.entry.amountUsd,
            reportedUsd: amountUsd,
            requestedUsd: begun.entry.requestedAmountUsd,
            ...(kind !== undefined ? { kind } : {}),
            ...(refId !== undefined ? { refId } : {}),
          },
          begun.entry.venueId,
        );
      }
      // SLICE-155-6: settle tx failed after reserve — alertable.
      if (!ok && begun.wallet) {
        emitSpendAlert(
          "spend.failed",
          begun.wallet,
          { entryId: begun.entry.id, amountUsd, kind, refId },
        );
      }
      return;
    }
    // No reservation (no caps) — still record settled spend so the
    // ledger reflects every platform payment.
    if (ok && begun.wallet && amountUsd !== undefined && kind && refId) {
      await deps.ledger.insert({
        id: newSpendId(),
        wallet: begun.wallet,
        amountUsd,
        kind,
        refId,
        state: "settled",
        at: Date.now(),
        ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
        ...(sourceChain ? { sourceChain } : {}),
        ...(begun.venueId ? { venueId: begun.venueId } : {}),
      });
    }
  };
}
