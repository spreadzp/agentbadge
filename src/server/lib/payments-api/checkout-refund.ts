/**
 * SLICE-222-6 — ops refund orchestration (extracted from
 * checkout.ts, file-size lint cap).
 *
 * Manual flow (D-222-6): ops sends the on-chain USDC refund via
 * treasury signer infra, then this path records it:
 *   OPEN REFUND_REQUEST exception → service.markRefunded →
 *   exception RESOLVED. Deterministic exception id
 *   (payment+txHash) dedupes repeated calls — a retried request
 *  can never open a second refund ticket for the same tx.
 */
import type {
  PaymentServiceStores,
  PaymentService,
} from "@agentbadge/payments";

export interface OpsRefundInput {
  paymentId: string;
  txHash: string;
  refundedBy: string;
  note?: string;
}

export async function refundPaymentOps(
  stores: PaymentServiceStores,
  service: PaymentService,
  input: OpsRefundInput,
): Promise<{ status: "REFUNDED" | "FAILED"; reason?: string }> {
  const exceptions = stores.exceptions;
  const excId = `exc-refund-req-${input.paymentId}-${input.txHash}`;
  if (exceptions) {
    await exceptions.append({
      id: excId,
      paymentId: input.paymentId,
      kind: "REFUND_REQUEST",
      severity: "WARN",
      details: {
        txHash: input.txHash,
        refundedBy: input.refundedBy,
        note: input.note ?? null,
      },
      status: "OPEN",
      createdAtMs: Date.now(),
    });
  }
  const res = await service.markRefunded(input);
  if (res.status === "REFUNDED" && exceptions) {
    await exceptions.resolve(
      excId,
      "RESOLVED",
      `refund recorded by ${input.refundedBy}`,
    );
  }
  return res;
}
