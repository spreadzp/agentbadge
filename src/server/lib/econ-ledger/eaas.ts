/**
 * SLICE-207-3: EaaS verdicts → `verify` events.
 *
 * `verdictId` is already the domain idempotency key
 * (keccak256(deliverableHash:policy:nonce)) → sourceId=verdictId, seq=1.
 * approve → outcome "pass", reject → "fail".
 */

import type { BuildEventInput } from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import type { StoredVerdict } from "../eaas/store.js";
import { emitEconomicEvent } from "./emit.js";

/** Pure mapper — StoredVerdict → canonical `verify` input. */
export function verdictToEconomic(verdict: StoredVerdict): BuildEventInput {
  const a = verdict.artifact;
  return {
    source: "eaas",
    sourceId: a.verdictId,
    seq: 1,
    kind: "verify",
    actor: a.evaluator,
    counterparty: verdict.consumerWallet ?? undefined,
    at: a.issuedAt,
    payload: {
      taskRef: a.deliverableHash,
      verdictId: a.verdictId,
      deliverableHash: a.deliverableHash,
      outcome: a.kind === "approve" ? "pass" : "fail",
      reasonCodes: [a.policy],
      txHash:
        verdict.paymentTx && /^0x[0-9a-fA-F]{64}$/.test(verdict.paymentTx)
          ? verdict.paymentTx
          : undefined,
    },
  };
}

/** Emit after a verdict is stored — idempotent on verdictId. */
export function emitEaasVerdict(
  verdict: StoredVerdict,
  ledger?: EconLedgerStore | null,
): void {
  emitEconomicEvent(verdictToEconomic(verdict), ledger);
}
